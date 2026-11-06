pub mod auth;
pub mod client;
pub mod downloader;
pub mod library;

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::path::PathBuf;
use tokio::sync::Mutex;
use tauri::{AppHandle, State};
use auth::{read_cookies, save_cookies, delete_cookies, clear_webview_storage, UserProfile, AuthError};
use client::{CourseraClient, EnrolledCourse};
use downloader::{CourseManifest, build_course_manifest, download_single_task, resolve_path};

pub struct AppState {
    pub client: Arc<Mutex<Option<CourseraClient>>>,
    pub active_manifest: Arc<Mutex<Option<CourseManifest>>>,
    pub is_downloading: Arc<Mutex<bool>>,
    pub output_dir: Arc<Mutex<Option<PathBuf>>>,
}

#[tauri::command]
async fn check_auth(state: State<'_, AppState>) -> Result<UserProfile, AuthError> {
    let raw = read_cookies()?;
    let mut client = CourseraClient::new(&raw)?;
    let profile = client.validate_and_get_profile().await?;
    
    let mut guard = state.client.lock().await;
    *guard = Some(client);

    Ok(profile)
}

#[tauri::command]
async fn login_with_cookies(cookies: String, state: State<'_, AppState>) -> Result<UserProfile, AuthError> {
    save_cookies(&cookies)?;
    let mut client = CourseraClient::new(&cookies)?;
    let profile = client.validate_and_get_profile().await?;

    let mut guard = state.client.lock().await;
    *guard = Some(client);

    Ok(profile)
}

#[tauri::command]
async fn logout(state: State<'_, AppState>) -> Result<(), AuthError> {
    delete_cookies()?;
    let mut guard = state.client.lock().await;
    *guard = None;
    Ok(())
}

#[tauri::command]
async fn open_login_webview(app: AppHandle, state: State<'_, AppState>) -> Result<UserProfile, String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder, Manager, Listener, Emitter};

    // Close any existing login window
    if let Some(existing) = app.get_webview_window("coursera_login") {
        let _ = existing.close();
    }

    clear_webview_storage();

    let parsed_url = "https://www.coursera.org/?authMode=login"
        .parse::<tauri::Url>()
        .map_err(|e| e.to_string())?;
    println!("[Webview Login] Launching Coursera login window...");

    let login_window = WebviewWindowBuilder::new(
        &app,
        "coursera_login",
        WebviewUrl::External(parsed_url)
    )
    .title("Login to Coursera — Coursera DL")
    .devtools(true)
    .incognito(true)
    .inner_size(980.0, 720.0)
    .min_inner_size(600.0, 500.0)
    .center()
    .resizable(true)
    .build()
    .map_err(|e| e.to_string())?;

    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(10);

    let app_handle_cancel = app.clone();
    let win_cancel = login_window.clone();
    let (cancel_tx, mut cancel_rx) = tokio::sync::mpsc::channel::<()>(1);
    let unlisten_cancel = app.listen("coursera-cancel-login", move |_| {
        println!("[Webview Login] Received cancellation signal");
        let _ = win_cancel.hide();
        let _ = win_cancel.close();
        let _ = cancel_tx.try_send(());
    });

    // 2. Poll the webview's native cookie store. `CAUTH` is HttpOnly, so it is
    // intentionally invisible to `document.cookie`; Tauri's cookie API is the
    // reliable cross-platform source for it.
    let tx_poll = tx.clone();
    let win_poll = login_window.clone();
    let poll_task = tokio::spawn(async move {
        for attempt in 0..600 {
            tokio::time::sleep(tokio::time::Duration::from_millis(600)).await;

            // Do not use `cookies_for_url` here. On macOS, Wry compares the
            // domain literally, so `.coursera.org` does not match
            // `www.coursera.org` and the HttpOnly CAUTH cookie gets dropped.
            match win_poll.cookies() {
                Ok(cookies) => {
                    let coursera_cookies = cookies
                        .iter()
                        .filter(|cookie| {
                            cookie.domain().is_some_and(|domain| {
                                let domain = domain.trim_start_matches('.');
                                domain == "coursera.org" || domain.ends_with(".coursera.org")
                            })
                        })
                        .collect::<Vec<_>>();

                    if coursera_cookies.iter().any(|cookie| cookie.name() == "CAUTH") {
                        let cookie_header = coursera_cookies
                            .iter()
                            .map(|cookie| format!("{}={}", cookie.name(), cookie.value()))
                            .collect::<Vec<_>>()
                            .join("; ");

                        println!("[Webview Login] Captured {} Coursera cookies from the native cookie store", coursera_cookies.len());
                        let _ = tx_poll.try_send(cookie_header);
                        break;
                    }

                    if attempt == 0 || attempt % 20 == 0 {
                        println!(
                            "[Webview Login] Waiting for CAUTH ({} total cookies, {} Coursera cookies)...",
                            cookies.len(),
                            coursera_cookies.len()
                        );
                    }
                }
                Err(error) => {
                    let error = error.to_string();
                    println!("[Webview Login] Unable to read native cookie store: {error}");
                    if error.contains("not found") || error.contains("closed") {
                        break;
                    }
                }
            }

        }
    });

    let result: Result<UserProfile, String> = tokio::select! {
        Some(raw_cookies) = rx.recv() => {
            poll_task.abort();
            println!("[Webview Login] Cookies captured! Hiding and closing webview immediately...");

            // Instantly hide and close the webview window so the user is not left in the webview
            let _ = login_window.hide();
            let _ = login_window.close();
            app_handle_cancel.unlisten(unlisten_cancel);

            // Inform frontend that cookies were captured and verification is running
            let _ = app.emit("coursera-verifying-details", ());

            let final_cookies = raw_cookies;

            println!("[Webview Login] Saving cookies to local disk...");
            save_cookies(&final_cookies).map_err(|e| {
                println!("[Webview Login] Error saving cookies: {}", e);
                e.to_string()
            })?;

            println!("[Webview Login] Verifying details with Coursera...");
            let mut client = CourseraClient::new(&final_cookies).map_err(|e| {
                println!("[Webview Login] CourseraClient init error: {}", e);
                e.to_string()
            })?;

            let profile = client.validate_and_get_profile().await.map_err(|e| {
                println!("[Webview Login] Verification error: {}", e);
                e.to_string()
            })?;

            println!("[Webview Login] Verification successful! User: {:?}", profile.name.as_deref().unwrap_or(&profile.user_id));

            // Clear webview cookies/storage so session isn't stuck in webview
            clear_webview_storage();

            let mut guard = state.client.lock().await;
            *guard = Some(client);

            Ok(profile)
        }
        _ = cancel_rx.recv() => {
            poll_task.abort();
            app_handle_cancel.unlisten(unlisten_cancel);
            Err("Coursera login was cancelled".to_string())
        }
        _ = tokio::time::sleep(tokio::time::Duration::from_secs(300)) => {
            poll_task.abort();
            println!("[Webview Login] Webview login timed out after 5 minutes");
            let _ = login_window.hide();
            let _ = login_window.close();
            app_handle_cancel.unlisten(unlisten_cancel);
            Err("Login timed out after 5 minutes".to_string())
        }
    };

    result
}

#[tauri::command]
async fn cancel_login_webview(app: AppHandle) -> Result<(), String> {
    use tauri::{Manager, Emitter};
    println!("[Webview Login] cancel_login_webview invoked");
    let _ = app.emit("coursera-cancel-login", ());
    if let Some(win) = app.get_webview_window("coursera_login") {
        let _ = win.hide();
        let _ = win.close();
    }
    clear_webview_storage();
    Ok(())
}


#[tauri::command]
async fn get_enrolled_courses(state: State<'_, AppState>) -> Result<Vec<EnrolledCourse>, String> {
    let guard = state.client.lock().await;
    let client = guard.as_ref().ok_or_else(|| "Not logged in".to_string())?;
    client.get_enrolled_courses().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_specialization_details(slug: String, state: State<'_, AppState>) -> Result<client::SpecializationDetails, String> {
    let guard = state.client.lock().await;
    let client = guard.as_ref().ok_or_else(|| "Not logged in".to_string())?;
    client.get_specialization_details(&slug).await
}

#[tauri::command]
async fn enroll_in_course(course_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let guard = state.client.lock().await;
    let client = guard.as_ref().ok_or_else(|| "Not logged in".to_string())?;
    client.enroll_in_course(&course_id).await
}

#[tauri::command]
async fn enroll_in_specialization_all(spec_id: String, course_ids: Vec<String>, state: State<'_, AppState>) -> Result<(), String> {
    let guard = state.client.lock().await;
    let client = guard.as_ref().ok_or_else(|| "Not logged in".to_string())?;
    client.enroll_in_specialization_all(&spec_id, &course_ids).await
}

#[tauri::command]
async fn prepare_course_download(
    slug: String,
    is_spec: bool,
    prefix_sep: Option<String>,
    max_resolution: Option<u32>,
    state: State<'_, AppState>,
) -> Result<CourseManifest, String> {
    let guard = state.client.lock().await;
    let client = guard.as_ref().ok_or_else(|| "Not logged in".to_string())?;
    let sep = prefix_sep.unwrap_or_else(|| " - ".to_string());

    let mut manifest = build_course_manifest(client, &slug, is_spec, &sep, max_resolution).await?;
    
    let out_dir = {
        let out_guard = state.output_dir.lock().await;
        out_guard.clone().unwrap_or_else(|| resolve_path("~/Downloads/Coursera"))
    };
    downloader::check_existing_files(&mut manifest, &out_dir).await;
    for outline in &manifest.outlines {
        if let Err(e) = library::write_outline(outline, &out_dir.join(&outline.root_folder)) {
            println!("[Library] Failed to write course.json for {}: {}", outline.slug, e);
        }
    }

    let mut m_guard = state.active_manifest.lock().await;
    *m_guard = Some(manifest.clone());

    Ok(manifest)
}

#[tauri::command]
async fn get_courses_download_status(
    slugs: Vec<String>,
    state: State<'_, AppState>,
) -> Result<std::collections::HashMap<String, downloader::CourseDownloadInfo>, String> {
    let out_dir = {
        let guard = state.output_dir.lock().await;
        guard.clone().unwrap_or_else(|| resolve_path("~/Downloads/Coursera"))
    };

    let mut results = std::collections::HashMap::new();
    for slug in slugs {
        let info = downloader::get_course_download_status_on_disk(&slug, &out_dir);
        results.insert(slug, info);
    }
    Ok(results)
}

#[tauri::command]
async fn get_all_downloaded_items(
    state: State<'_, AppState>,
) -> Result<Vec<downloader::DownloadedItem>, String> {
    let out_dir = {
        let guard = state.output_dir.lock().await;
        guard.clone().unwrap_or_else(|| resolve_path("~/Downloads/Coursera"))
    };
    let client = {
        let guard = state.client.lock().await;
        guard.clone()
    };
    Ok(downloader::get_all_downloaded_items(&out_dir, client.as_ref()).await)
}

async fn current_output_dir(state: &State<'_, AppState>) -> PathBuf {
    let guard = state.output_dir.lock().await;
    guard.clone().unwrap_or_else(|| resolve_path("~/Downloads/Coursera"))
}

/// Let the webview stream files (video, images, PDFs) from this directory via the asset protocol.
fn allow_asset_dir(app: &AppHandle, dir: &std::path::Path) {
    use tauri::Manager;
    if let Err(e) = app.asset_protocol_scope().allow_directory(dir, true) {
        println!("[Library] Could not allow asset access to {:?}: {}", dir, e);
    }
}

#[tauri::command]
async fn get_course_outline(path: String, app: AppHandle) -> Result<library::CourseOutline, String> {
    let dir = resolve_path(&path);
    if !dir.is_dir() {
        return Err(format!("Course folder not found: {}", dir.display()));
    }
    allow_asset_dir(&app, &dir);
    let outline = tokio::task::spawn_blocking(move || library::load_outline(&dir))
        .await
        .map_err(|e| e.to_string())?;
    Ok(outline)
}

/// Re-fetch the course structure for an already-downloaded course folder and write `course.json`.
/// Also prepares a download manifest so any missing files (e.g. reading images) can be fetched.
#[tauri::command]
async fn rebuild_course_metadata(
    path: String,
    slug: Option<String>,
    max_resolution: Option<u32>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<RebuildResult, String> {
    let client = {
        let guard = state.client.lock().await;
        guard.clone().ok_or_else(|| "Not logged in".to_string())?
    };
    let course_dir = resolve_path(&path);
    let base_dir = course_dir.parent().ok_or("Invalid course folder")?.to_path_buf();
    let root_folder = course_dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or("Invalid course folder")?;
    let slug = slug.filter(|s| !s.is_empty()).unwrap_or_else(|| library::infer_slug(&course_dir));

    // Detect the separator the folder was downloaded with (default " - ")
    let probe = library::fetch_outline(&client, &slug, " - ").await?;
    let sep = library::detect_prefix_sep(&course_dir, &probe).unwrap_or_else(|| " - ".to_string());

    let mut tasks = Vec::new();
    let outline = downloader::gather_course_items(&client, &slug, &root_folder, &sep, max_resolution, &mut tasks).await?;
    library::write_outline(&outline, &course_dir)?;

    let mut manifest = CourseManifest {
        course_name: root_folder,
        slug: slug.clone(),
        is_spec: false,
        photo_url: outline.photo_url.clone(),
        total_files: tasks.len(),
        tasks,
        total_size_est: 0,
        outlines: vec![],
        base_dir: Some(base_dir.clone()),
    };
    downloader::check_existing_files(&mut manifest, &base_dir).await;
    *state.active_manifest.lock().await = Some(manifest.clone());

    allow_asset_dir(&app, &course_dir);
    Ok(RebuildResult { outline: library::load_outline(&course_dir), manifest })
}

#[derive(serde::Serialize)]
struct RebuildResult {
    outline: library::CourseOutline,
    manifest: CourseManifest,
}

async fn require_client(state: &State<'_, AppState>) -> Result<CourseraClient, String> {
    let guard = state.client.lock().await;
    guard.clone().ok_or_else(|| "Not logged in".to_string())
}

/// Fetch a course's outline live from Coursera so it can be browsed before (or while) downloading.
/// Items already on disk are marked `available` and play locally; the rest stream online.
#[tauri::command]
async fn get_course_preview(
    slug: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<library::CourseOutline, String> {
    let client = require_client(&state).await?;
    let out_dir = current_output_dir(&state).await;

    let local = {
        let slug = slug.clone();
        let out_dir = out_dir.clone();
        tokio::task::spawn_blocking(move || downloader::get_course_download_status_on_disk(&slug, &out_dir))
            .await
            .map_err(|e| e.to_string())?
    };
    let local_dir = std::path::PathBuf::from(&local.path);
    let has_local = local.downloaded_files > 0 && local_dir.is_dir();

    let mut outline = library::fetch_outline(&client, &slug, " - ").await?;
    if has_local {
        if let Some(sep) = library::detect_prefix_sep(&local_dir, &outline) {
            if sep != " - " {
                outline = library::fetch_outline(&client, &slug, &sep).await?;
            }
        }
        library::annotate_local(&mut outline, &local_dir);
        allow_asset_dir(&app, &local_dir);
    } else {
        library::clear_local(&mut outline);
    }
    outline.preview = true;
    Ok(outline)
}

#[tauri::command]
async fn get_lecture_stream(
    course_id: String,
    item_id: String,
    max_resolution: Option<u32>,
    state: State<'_, AppState>,
) -> Result<library::LectureStream, String> {
    let client = require_client(&state).await?;
    library::lecture_stream(&client, &course_id, &item_id, max_resolution).await
}

#[tauri::command]
async fn get_remote_reading(
    course_id: String,
    item_id: String,
    state: State<'_, AppState>,
) -> Result<library::RemoteReading, String> {
    let client = require_client(&state).await?;
    library::remote_reading(&client, &course_id, &item_id).await
}

#[tauri::command]
async fn read_course_file(path: String, state: State<'_, AppState>) -> Result<String, String> {
    let out_dir = current_output_dir(&state).await;
    let target = resolve_path(&path);
    tokio::task::spawn_blocking(move || library::read_text_within(&target, &out_dir))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_course_progress(course_key: String) -> Result<serde_json::Value, String> {
    Ok(library::read_progress(&course_key))
}

#[tauri::command]
async fn save_course_progress(course_key: String, progress: serde_json::Value) -> Result<(), String> {
    library::write_progress(&course_key, &progress)
}

#[tauri::command]
async fn set_output_directory(path: String, app: AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    let resolved = resolve_path(&path);
    allow_asset_dir(&app, &resolved);
    let mut out = state.output_dir.lock().await;
    *out = Some(resolved.clone());
    Ok(resolved.to_string_lossy().to_string())
}

/// Open a downloaded course file (PDF, notebook, ...) with the system's default app.
#[tauri::command]
async fn open_course_file(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let out_dir = current_output_dir(&state).await;
    let target = resolve_path(&path).canonicalize().map_err(|e| e.to_string())?;
    let root = out_dir.canonicalize().map_err(|e| e.to_string())?;
    if !target.starts_with(&root) || !target.is_file() {
        return Err("Only files inside the download folder can be opened".into());
    }
    #[cfg(target_os = "macos")]
    let cmd = "open";
    #[cfg(target_os = "windows")]
    let cmd = "explorer";
    #[cfg(target_os = "linux")]
    let cmd = "xdg-open";
    std::process::Command::new(cmd).arg(&target).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn open_download_folder(path: Option<String>, state: State<'_, AppState>) -> Result<(), String> {
    let folder = if let Some(p) = path {
        resolve_path(&p)
    } else {
        let guard = state.output_dir.lock().await;
        guard.clone().unwrap_or_else(|| resolve_path("~/Downloads/Coursera"))
    };

    if !folder.exists() {
        let _ = tokio::fs::create_dir_all(&folder).await;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&folder)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&folder)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&folder)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
async fn start_download(
    max_concurrent: Option<usize>,
    min_delay: Option<u64>,
    max_delay: Option<u64>,
    delay_videos_only: Option<bool>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let manifest_opt = {
        let guard = state.active_manifest.lock().await;
        guard.clone()
    };
    let manifest = manifest_opt.ok_or_else(|| "No active course manifest. Prepare download first.".to_string())?;

    let client_opt = {
        let guard = state.client.lock().await;
        guard.clone()
    };
    let client = client_opt.ok_or_else(|| "Not authenticated".to_string())?;

    let out_dir = match manifest.base_dir.clone() {
        Some(dir) => dir,
        None => {
            let guard = state.output_dir.lock().await;
            guard.clone().unwrap_or_else(|| resolve_path("~/Downloads/Coursera"))
        }
    };

    let is_dl_flag = state.is_downloading.clone();
    {
        let mut dl_guard = is_dl_flag.lock().await;
        if *dl_guard {
            return Err("Download already in progress".to_string());
        }
        *dl_guard = true;
    }

    tokio::spawn(async move {
        let total = manifest.tasks.len();
        let already_completed = manifest.tasks.iter().filter(|t| t.status == downloader::TaskStatus::Completed).count();
        let completed = Arc::new(AtomicUsize::new(already_completed));
        
        let has_delay = max_delay.map(|d| d > 0).unwrap_or(false) || min_delay.map(|d| d > 0).unwrap_or(false);
        // If delay is active, force concurrency to 1 (sequential)
        let concurrency = if has_delay {
            1
        } else {
            max_concurrent.unwrap_or(4).clamp(1, 16)
        };
        
        let sem = Arc::new(tokio::sync::Semaphore::new(concurrency));
        let mut handlers = Vec::new();

        let tasks_to_download: Vec<_> = manifest.tasks.into_iter().filter(|t| t.status != downloader::TaskStatus::Completed).collect();

        if tasks_to_download.is_empty() {
            let mut dl_guard = is_dl_flag.lock().await;
            *dl_guard = false;
            let _ = tauri::Emitter::emit(&app, "download_progress", downloader::DownloadProgressEvent {
                task_id: "all".to_string(),
                status: downloader::TaskStatus::Completed,
                downloaded_bytes: 0,
                total_bytes: 0,
                progress_percent: 100.0,
                current_file: "All files already downloaded".to_string(),
                overall_completed: total,
                overall_total: total,
                error: None,
            });
            return;
        }

        let mut is_first_task = true;

        for mut task in tasks_to_download {
            let client_c = client.clone();
            let out_dir_c = out_dir.clone();
            let app_c = app.clone();
            let completed_c = completed.clone();
            let permit = match sem.clone().acquire_owned().await {
                Ok(p) => p,
                Err(_) => break,
            };

            // Apply random delay before downloading files (or for videos only if enabled)
            let is_video = task.relative_path.ends_with(".mp4");
            let should_delay = has_delay && !is_first_task && (!delay_videos_only.unwrap_or(false) || is_video);
            
            if should_delay {
                let min_s = min_delay.unwrap_or(1);
                let max_s = max_delay.unwrap_or(min_s).max(min_s);
                let delay_secs = if min_s == max_s {
                    min_s
                } else {
                    rand::Rng::gen_range(&mut rand::thread_rng(), min_s..=max_s)
                };
                if delay_secs > 0 {
                    tokio::time::sleep(tokio::time::Duration::from_secs(delay_secs)).await;
                }
            }
            is_first_task = false;

            handlers.push(tokio::spawn(async move {
                let _permit = permit;
                let cur = completed_c.load(Ordering::Relaxed);
                let res = download_single_task(&client_c, &mut task, &out_dir_c, Some(&app_c), cur, total).await;
                if res.is_ok() {
                    completed_c.fetch_add(1, Ordering::Relaxed);
                }
            }));
        }

        for h in handlers {
            let _ = h.await;
        }

        let mut dl_guard = is_dl_flag.lock().await;
        *dl_guard = false;

        let final_count = completed.load(Ordering::Relaxed);
        let _ = tauri::Emitter::emit(&app, "download_progress", downloader::DownloadProgressEvent {
            task_id: "all".to_string(),
            status: downloader::TaskStatus::Completed,
            downloaded_bytes: 0,
            total_bytes: 0,
            progress_percent: 100.0,
            current_file: "Finished".to_string(),
            overall_completed: final_count,
            overall_total: total,
            error: None,
        });
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            client: Arc::new(Mutex::new(None)),
            active_manifest: Arc::new(Mutex::new(None)),
            is_downloading: Arc::new(Mutex::new(false)),
            output_dir: Arc::new(Mutex::new(Some(resolve_path("~/Downloads/Coursera")))),
        })
        .invoke_handler(tauri::generate_handler![
            check_auth,
            login_with_cookies,
            open_login_webview,
            cancel_login_webview,
            logout,
            get_enrolled_courses,
            get_courses_download_status,
            get_all_downloaded_items,
            get_specialization_details,
            enroll_in_course,
            enroll_in_specialization_all,
            prepare_course_download,
            set_output_directory,
            open_download_folder,
            start_download,
            get_course_outline,
            get_course_preview,
            get_lecture_stream,
            get_remote_reading,
            open_course_file,
            rebuild_course_metadata,
            read_course_file,
            get_course_progress,
            save_course_progress
        ])
        .run(tauri::generate_context!())
        .expect("error while running coursera dl application");
}
