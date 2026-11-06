//! Offline course library: structured course outlines (`course.json`), outline inference for
//! folders without metadata, learner progress persistence and scoped local file reads.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::client::{CourseraClient, COURSERA_BASE};
use crate::downloader::{get_downloads_db_path, read_downloads_db, sanitize_name};

pub const OUTLINE_FILE: &str = "course.json";
pub const OUTLINE_VERSION: u32 = 1;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SubtitleTrack {
    pub lang: String,
    pub path: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct OutlineItem {
    pub id: String,
    pub name: String,
    pub slug: String,
    /// Coursera content type: lecture, supplement, staffGraded, gradedProgramming, discussionPrompt, ...
    pub item_type: String,
    pub duration_ms: u64,
    #[serde(default)]
    pub locked: bool,
    /// Paths are relative to the course directory (where `course.json` lives).
    pub video: Option<String>,
    #[serde(default)]
    pub subtitles: Vec<SubtitleTrack>,
    pub reading: Option<String>,
    pub url: String,
    /// Computed when the outline is read: whether the primary file exists on disk.
    #[serde(default)]
    pub available: bool,
    /// Position of the item inside its lesson's `itemIds` (drives the `NN - ` file prefix).
    #[serde(skip)]
    pub index: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct OutlineLesson {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub duration_ms: u64,
    pub folder: String,
    pub items: Vec<OutlineItem>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct OutlineModule {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub duration_ms: u64,
    #[serde(default)]
    pub optional: bool,
    pub folder: String,
    pub lessons: Vec<OutlineLesson>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CourseOutline {
    pub version: u32,
    pub slug: String,
    pub course_id: String,
    pub name: String,
    pub description: Option<String>,
    pub workload: Option<String>,
    pub photo_url: Option<String>,
    pub partner_name: Option<String>,
    pub partner_logo: Option<String>,
    pub modules: Vec<OutlineModule>,
    /// True when synthesized from folder names because `course.json` was missing.
    #[serde(default)]
    pub inferred: bool,
    /// True when fetched live from Coursera for previewing (items without local files stream online).
    #[serde(default)]
    pub preview: bool,
    /// Absolute course directory, filled in when read.
    #[serde(default)]
    pub course_dir: String,
    /// Reading attachments found in `_assets/`: asset id → file name. Filled in when read.
    #[serde(default, skip_deserializing)]
    pub assets: HashMap<String, String>,
    /// Folder of this course relative to the download base dir (used when writing).
    #[serde(skip)]
    pub root_folder: String,
}

fn str_field(v: &serde_json::Value, key: &str) -> Option<String> {
    v.get(key).and_then(|s| s.as_str()).map(String::from)
}

fn u64_field(v: &serde_json::Value, key: &str) -> u64 {
    v.get(key).and_then(|n| n.as_u64()).unwrap_or(0)
}

async fn get_json(client: &CourseraClient, url: &str) -> Result<serde_json::Value, String> {
    let resp = client.client().get(url).send().await.map_err(|e| e.to_string())?;
    resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

/// Fetch the full course structure from Coursera. File paths mirror exactly what the downloader
/// writes (`NN{sep}module-slug/NN{sep}lesson-slug/NN{sep}item-slug.ext`).
pub async fn fetch_outline(
    client: &CourseraClient,
    course_slug: &str,
    prefix_sep: &str,
) -> Result<CourseOutline, String> {
    let course_url = format!(
        "{}/api/onDemandCourses.v1?q=slug&slug={}&fields=name,description,photoUrl,promoPhoto,partnerIds,estimatedWorkload",
        COURSERA_BASE, course_slug
    );
    let course_info = get_json(client, &course_url).await?;
    let course = course_info
        .get("elements")
        .and_then(|e| e.as_array())
        .and_then(|arr| arr.first())
        .cloned()
        .ok_or_else(|| format!("Course '{}' not found or invalid", course_slug))?;
    let course_id = str_field(&course, "id")
        .ok_or_else(|| format!("Course '{}' has no id", course_slug))?;

    let mut partner_name = None;
    let mut partner_logo = None;
    if let Some(pid) = course
        .get("partnerIds")
        .and_then(|p| p.as_array())
        .and_then(|a| a.first())
        .and_then(|p| p.as_str())
    {
        let p_url = format!("{}/api/partners.v1?ids={}&fields=name,squareLogo,logo", COURSERA_BASE, pid);
        if let Ok(p_data) = get_json(client, &p_url).await {
            if let Some(p) = p_data.get("elements").and_then(|e| e.as_array()).and_then(|a| a.first()) {
                partner_name = str_field(p, "name");
                partner_logo = str_field(p, "squareLogo").or_else(|| str_field(p, "logo"));
            }
        }
    }

    let mat_url = format!(
        "{}/api/onDemandCourseMaterials.v2/?q=slug&slug={}&includes=modules,lessons,items&fields=onDemandCourseMaterialModules.v1(name,slug,description,timeCommitment,lessonIds,optional),onDemandCourseMaterialLessons.v1(name,slug,timeCommitment,itemIds),onDemandCourseMaterialItems.v2(name,slug,timeCommitment,contentSummary,isLocked)&showLockedItems=true",
        COURSERA_BASE, course_slug
    );
    let mat_data = get_json(client, &mat_url).await?;
    let linked = mat_data.get("linked");

    let index_by_id = |key: &str| -> HashMap<String, serde_json::Value> {
        linked
            .and_then(|l| l.get(key))
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| str_field(v, "id").map(|id| (id, v.clone())))
                    .collect()
            })
            .unwrap_or_default()
    };
    let item_map = index_by_id("onDemandCourseMaterialItems.v2");
    let lesson_map = index_by_id("onDemandCourseMaterialLessons.v1");

    let mut modules = Vec::new();
    if let Some(mods) = linked
        .and_then(|l| l.get("onDemandCourseMaterialModules.v1"))
        .and_then(|m| m.as_array())
    {
        for (m_idx, m) in mods.iter().enumerate() {
            let m_slug = m.get("slug").and_then(|s| s.as_str()).unwrap_or("module");
            let module_folder = format!("{:02}{}{}", m_idx + 1, prefix_sep, sanitize_name(m_slug));
            let mut lessons = Vec::new();

            for (l_idx, l_id) in m
                .get("lessonIds")
                .and_then(|l| l.as_array())
                .into_iter()
                .flatten()
                .enumerate()
            {
                let Some(lesson) = lesson_map.get(l_id.as_str().unwrap_or_default()) else { continue };
                let l_slug = lesson.get("slug").and_then(|s| s.as_str()).unwrap_or("lesson");
                let lesson_folder = format!("{:02}{}{}", l_idx + 1, prefix_sep, sanitize_name(l_slug));
                let mut items = Vec::new();

                for (it_idx, it_id) in lesson
                    .get("itemIds")
                    .and_then(|i| i.as_array())
                    .into_iter()
                    .flatten()
                    .enumerate()
                {
                    let it_id = it_id.as_str().unwrap_or_default();
                    let Some(item) = item_map.get(it_id) else { continue };
                    let item_slug = item.get("slug").and_then(|s| s.as_str()).unwrap_or("item");
                    let item_name = item.get("name").and_then(|s| s.as_str()).unwrap_or(item_slug);
                    let item_type = item
                        .get("contentSummary")
                        .and_then(|c| c.get("typeName"))
                        .and_then(|t| t.as_str())
                        .unwrap_or("")
                        .to_string();
                    let stem = format!(
                        "{}/{}/{:02}{}{}",
                        module_folder,
                        lesson_folder,
                        it_idx + 1,
                        prefix_sep,
                        sanitize_name(item_slug)
                    );

                    let (video, subtitles, reading) = match item_type.as_str() {
                        "lecture" => (
                            Some(format!("{}.mp4", stem)),
                            vec![SubtitleTrack { lang: "en".into(), path: format!("{}.srt", stem) }],
                            None,
                        ),
                        "supplement" => (None, vec![], Some(format!("{}.html", stem))),
                        _ => (None, vec![], None),
                    };

                    items.push(OutlineItem {
                        id: it_id.to_string(),
                        name: item_name.to_string(),
                        slug: item_slug.to_string(),
                        item_type,
                        duration_ms: u64_field(item, "timeCommitment"),
                        locked: item.get("isLocked").and_then(|b| b.as_bool()).unwrap_or(false),
                        video,
                        subtitles,
                        reading,
                        url: format!("{}/learn/{}/item/{}", COURSERA_BASE, course_slug, it_id),
                        available: false,
                        index: it_idx,
                    });
                }

                lessons.push(OutlineLesson {
                    id: str_field(lesson, "id").unwrap_or_default(),
                    name: str_field(lesson, "name").unwrap_or_else(|| l_slug.to_string()),
                    slug: l_slug.to_string(),
                    duration_ms: u64_field(lesson, "timeCommitment"),
                    folder: lesson_folder,
                    items,
                });
            }

            modules.push(OutlineModule {
                id: str_field(m, "id").unwrap_or_default(),
                name: str_field(m, "name").unwrap_or_else(|| m_slug.to_string()),
                slug: m_slug.to_string(),
                description: str_field(m, "description"),
                duration_ms: u64_field(m, "timeCommitment"),
                optional: m.get("optional").and_then(|b| b.as_bool()).unwrap_or(false),
                folder: module_folder,
                lessons,
            });
        }
    }

    Ok(CourseOutline {
        version: OUTLINE_VERSION,
        slug: course_slug.to_string(),
        course_id,
        name: str_field(&course, "name").unwrap_or_else(|| course_slug.to_string()),
        description: str_field(&course, "description"),
        workload: str_field(&course, "estimatedWorkload"),
        photo_url: str_field(&course, "photoUrl").or_else(|| str_field(&course, "promoPhoto")),
        partner_name,
        partner_logo,
        modules,
        inferred: false,
        ..Default::default()
    })
}

pub fn write_outline(outline: &CourseOutline, course_dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(course_dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(outline).map_err(|e| e.to_string())?;
    std::fs::write(course_dir.join(OUTLINE_FILE), json).map_err(|e| e.to_string())
}

/// Work out which prefix separator a course folder on disk was downloaded with, using the
/// first module of a freshly fetched outline (fetched with any separator).
pub fn detect_prefix_sep(course_dir: &Path, outline: &CourseOutline) -> Option<String> {
    let first = outline.modules.first()?;
    let slug_part = sanitize_name(&first.slug);
    for entry in std::fs::read_dir(course_dir).ok()?.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if entry.path().is_dir() && name.starts_with("01") && name.ends_with(&slug_part) && name.len() >= 2 + slug_part.len() {
            return Some(name[2..name.len() - slug_part.len()].to_string());
        }
    }
    None
}

/// Guess the Coursera slug of a course directory: first from the downloads DB, then by
/// stripping a `NN - ` style prefix from the folder name.
pub fn infer_slug(course_dir: &Path) -> String {
    let dir_str = course_dir.to_string_lossy().to_string();
    let db = read_downloads_db();
    if let Some(info) = db.values().find(|i| i.path == dir_str) {
        return info.slug.clone();
    }
    let name = course_dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    strip_index_prefix(&name)
}

fn strip_index_prefix(name: &str) -> String {
    let re = regex::Regex::new(r"^\d+\s*[-_.]\s*").unwrap();
    re.replace(name, "").trim().to_string()
}

fn title_case(slug: &str) -> String {
    slug.replace(['-', '_'], " ")
        .split_whitespace()
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                None => String::new(),
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn sorted_entries(dir: &Path) -> Vec<PathBuf> {
    let mut entries: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|rd| rd.flatten().map(|e| e.path()).collect())
        .unwrap_or_default();
    entries.retain(|p| {
        p.file_name()
            .map(|n| !n.to_string_lossy().starts_with('.') && !n.to_string_lossy().starts_with('_'))
            .unwrap_or(false)
    });
    entries.sort();
    entries
}

/// Build an outline from the folder tree when `course.json` does not exist.
pub fn infer_outline(course_dir: &Path) -> CourseOutline {
    let folder_name = course_dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let slug = infer_slug(course_dir);
    let mut modules = Vec::new();

    for m_path in sorted_entries(course_dir).into_iter().filter(|p| p.is_dir()) {
        let m_folder = m_path.file_name().unwrap().to_string_lossy().to_string();
        let m_slug = strip_index_prefix(&m_folder);
        let mut lessons = Vec::new();

        for l_path in sorted_entries(&m_path).into_iter().filter(|p| p.is_dir()) {
            let l_folder = l_path.file_name().unwrap().to_string_lossy().to_string();
            let l_slug = strip_index_prefix(&l_folder);

            // Group files by stem: video + subtitles + reading share the same `NN - slug` stem.
            let mut stems: Vec<String> = Vec::new();
            let mut by_stem: HashMap<String, Vec<String>> = HashMap::new();
            for f in sorted_entries(&l_path).into_iter().filter(|p| p.is_file()) {
                let stem = f.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
                let ext = f.extension().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
                if !by_stem.contains_key(&stem) {
                    stems.push(stem.clone());
                }
                by_stem.entry(stem).or_default().push(ext);
            }

            let mut items = Vec::new();
            for (idx, stem) in stems.iter().enumerate() {
                let exts = &by_stem[stem];
                let rel = format!("{}/{}/{}", m_folder, l_folder, stem);
                let item_slug = strip_index_prefix(stem);
                let has = |e: &str| exts.iter().any(|x| x == e);
                let (item_type, video, reading) = if has("mp4") {
                    ("lecture", Some(format!("{}.mp4", rel)), None)
                } else if has("html") {
                    ("supplement", None, Some(format!("{}.html", rel)))
                } else {
                    continue;
                };
                let subtitles = exts
                    .iter()
                    .filter(|e| *e == "srt" || *e == "vtt")
                    .map(|e| SubtitleTrack { lang: "en".into(), path: format!("{}.{}", rel, e) })
                    .collect();
                items.push(OutlineItem {
                    id: rel.clone(),
                    name: title_case(&item_slug),
                    slug: item_slug.clone(),
                    item_type: item_type.into(),
                    duration_ms: 0,
                    locked: false,
                    video,
                    subtitles,
                    reading,
                    url: format!("{}/learn/{}", COURSERA_BASE, slug),
                    available: false,
                    index: idx,
                });
            }

            lessons.push(OutlineLesson {
                id: format!("{}/{}", m_folder, l_folder),
                name: title_case(&l_slug),
                slug: l_slug,
                duration_ms: 0,
                folder: l_folder,
                items,
            });
        }

        if lessons.is_empty() {
            continue;
        }
        modules.push(OutlineModule {
            id: m_folder.clone(),
            name: title_case(&m_slug),
            slug: m_slug,
            description: None,
            duration_ms: 0,
            optional: false,
            folder: m_folder,
            lessons,
        });
    }

    let photo_url = read_downloads_db().get(&slug).and_then(|i| i.photo_url.clone());
    CourseOutline {
        version: OUTLINE_VERSION,
        slug: slug.clone(),
        course_id: String::new(),
        name: title_case(if slug.is_empty() { &folder_name } else { &slug }),
        photo_url,
        modules,
        inferred: true,
        ..Default::default()
    }
}

/// Read `course.json` (or infer one) and mark which items have their files on disk.
pub fn load_outline(course_dir: &Path) -> CourseOutline {
    let mut outline = std::fs::read_to_string(course_dir.join(OUTLINE_FILE))
        .ok()
        .and_then(|s| serde_json::from_str::<CourseOutline>(&s).ok())
        .unwrap_or_else(|| infer_outline(course_dir));
    annotate_local(&mut outline, course_dir);
    outline
}

/// Mark which items have their files in `course_dir` and collect the `_assets` map.
pub fn annotate_local(outline: &mut CourseOutline, course_dir: &Path) {
    outline.course_dir = course_dir.to_string_lossy().to_string();
    outline.assets = std::fs::read_dir(course_dir.join("_assets"))
        .map(|rd| {
            rd.flatten()
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    let id = name.split('.').next()?.to_string();
                    Some((id, name))
                })
                .collect()
        })
        .unwrap_or_default();
    for m in outline.modules.iter_mut() {
        for l in m.lessons.iter_mut() {
            for it in l.items.iter_mut() {
                let primary = it.video.as_ref().or(it.reading.as_ref());
                it.available = primary.map(|p| course_dir.join(p).is_file()).unwrap_or(false);
                it.subtitles.retain(|s| course_dir.join(&s.path).is_file());
            }
        }
    }
}

/// Mark every item as not downloaded (no local folder).
pub fn clear_local(outline: &mut CourseOutline) {
    outline.course_dir = String::new();
    outline.assets.clear();
    for m in outline.modules.iter_mut() {
        for l in m.lessons.iter_mut() {
            for it in l.items.iter_mut() {
                it.available = false;
                it.subtitles.clear();
            }
        }
    }
}

// ── Online preview ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct LectureStream {
    pub video_url: String,
    pub resolution: String,
    /// English subtitles (SRT text), if available.
    pub subtitles: Option<String>,
}

pub async fn lecture_stream(
    client: &CourseraClient,
    course_id: &str,
    item_id: &str,
    max_resolution: Option<u32>,
) -> Result<LectureStream, String> {
    let url = format!(
        "{}/api/onDemandLectureVideos.v1/{}~{}?includes=video&fields=onDemandVideos.v1(sources,subtitles)",
        COURSERA_BASE, course_id, item_id
    );
    let data = get_json(client, &url).await?;
    let video = data
        .get("linked")
        .and_then(|l| l.get("onDemandVideos.v1"))
        .and_then(|v| v.as_array())
        .and_then(|a| a.first())
        .ok_or("This video isn't available — the item may be locked for your account.")?;
    let sources = video
        .get("sources")
        .and_then(|s| s.get("byResolution"))
        .and_then(|b| b.as_object())
        .ok_or("No video sources returned")?;
    let (resolution, video_url) =
        crate::downloader::pick_mp4_source(sources, max_resolution).ok_or("No MP4 source available")?;

    let mut subtitles = None;
    if let Some(sub) = video.get("subtitles").and_then(|s| s.get("en")).and_then(|u| u.as_str()) {
        let sub_url = if sub.starts_with("http") { sub.to_string() } else { format!("{}{}", COURSERA_BASE, sub) };
        if let Ok(resp) = client.client().get(&sub_url).send().await {
            if resp.status().is_success() {
                subtitles = resp.text().await.ok();
            }
        }
    }
    Ok(LectureStream { video_url, resolution, subtitles })
}

#[derive(Debug, Clone, Serialize)]
pub struct RemoteReading {
    pub cml: String,
    pub assets: Vec<crate::downloader::ReadingAsset>,
}

pub async fn remote_reading(client: &CourseraClient, course_id: &str, item_id: &str) -> Result<RemoteReading, String> {
    let url = format!(
        "{}/api/onDemandSupplements.v1/{}~{}?includes=asset&fields=openCourseAssets.v1(typeName,definition)",
        COURSERA_BASE, course_id, item_id
    );
    let data = get_json(client, &url).await?;
    let cml = data
        .get("linked")
        .and_then(|l| l.get("openCourseAssets.v1"))
        .and_then(|a| a.as_array())
        .into_iter()
        .flatten()
        .filter_map(|a| a.get("definition").and_then(|d| d.get("value")).and_then(|v| v.as_str()))
        .collect::<Vec<_>>()
        .join("\n");
    if cml.is_empty() {
        return Err("This reading isn't available — the item may be locked for your account.".into());
    }
    let assets = crate::downloader::resolve_reading_assets(client.client(), &cml).await;
    Ok(RemoteReading { cml, assets })
}

// ── Progress ────────────────────────────────────────────────────────────────

fn progress_path(course_key: &str) -> Result<PathBuf, String> {
    let base = get_downloads_db_path()?
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or("No config dir")?;
    let dir = base.join("progress");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{}.json", sanitize_name(course_key))))
}

pub fn read_progress(course_key: &str) -> serde_json::Value {
    progress_path(course_key)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

pub fn write_progress(course_key: &str, progress: &serde_json::Value) -> Result<(), String> {
    let path = progress_path(course_key)?;
    let json = serde_json::to_string_pretty(progress).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

/// Read a text file, refusing anything outside `allowed_root`.
pub fn read_text_within(path: &Path, allowed_root: &Path) -> Result<String, String> {
    let canon = path.canonicalize().map_err(|e| format!("{}: {}", path.display(), e))?;
    let root = allowed_root.canonicalize().map_err(|e| e.to_string())?;
    if !canon.starts_with(&root) {
        return Err("Access outside the download folder is not allowed".into());
    }
    std::fs::read_to_string(&canon).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_prefixes() {
        assert_eq!(strip_index_prefix("01 - course-overview"), "course-overview");
        assert_eq!(strip_index_prefix("3d-printing"), "3d-printing");
        assert_eq!(strip_index_prefix("02_heaps"), "heaps");
    }

    #[test]
    fn detects_separator_from_disk() {
        let tmp = std::env::temp_dir().join(format!("cdl-sep-{}", std::process::id()));
        std::fs::create_dir_all(tmp.join("01_basics-of-algorithms")).unwrap();
        let outline = CourseOutline {
            modules: vec![OutlineModule { slug: "basics-of-algorithms".into(), ..Default::default() }],
            ..Default::default()
        };
        assert_eq!(detect_prefix_sep(&tmp, &outline).as_deref(), Some("_"));
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn infers_outline_from_tree() {
        let tmp = std::env::temp_dir().join(format!("cdl-test-{}", std::process::id()));
        let lesson = tmp.join("my-course/01 - basics/02 - intro-lesson");
        std::fs::create_dir_all(&lesson).unwrap();
        std::fs::write(lesson.join("01 - what-is-it.mp4"), b"x").unwrap();
        std::fs::write(lesson.join("01 - what-is-it.srt"), b"1").unwrap();
        std::fs::write(lesson.join("02 - read-me.html"), b"<co-content/>").unwrap();

        let o = load_outline(&tmp.join("my-course"));
        assert!(o.inferred);
        assert_eq!(o.modules.len(), 1);
        assert_eq!(o.modules[0].name, "Basics");
        let items = &o.modules[0].lessons[0].items;
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].item_type, "lecture");
        assert_eq!(items[0].subtitles.len(), 1);
        assert!(items[0].available);
        assert_eq!(items[1].item_type, "supplement");
        std::fs::remove_dir_all(&tmp).ok();
    }
}

#[cfg(test)]
mod live_tests {
    /// Fetches a real outline with the saved login. Run with:
    /// `COURSE_SLUG=<slug> cargo test live_outline -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn live_stream_unenrolled() {
        let raw = crate::auth::read_cookies().expect("saved cookies");
        let client = crate::client::CourseraClient::new(&raw).expect("client");
        let o = super::fetch_outline(&client, "foundations-of-cybersecurity", " - ").await.expect("outline");
        let lec = o.modules.iter().flat_map(|m| &m.lessons).flat_map(|l| &l.items).find(|i| i.item_type == "lecture").unwrap();
        let s = super::lecture_stream(&client, &o.course_id, &lec.id, Some(720)).await.expect("stream");
        println!("STREAM {} subs={}", &s.video_url[..60], s.subtitles.as_ref().map(|t| t.len()).unwrap_or(0));
        let rd = o.modules.iter().flat_map(|m| &m.lessons).flat_map(|l| &l.items).find(|i| i.item_type == "supplement").unwrap();
        let r = super::remote_reading(&client, &o.course_id, &rd.id).await.expect("reading");
        println!("READING {} chars, {} assets", r.cml.len(), r.assets.len());
    }

    #[tokio::test]
    #[ignore]
    async fn live_outline() {
        let slug = std::env::var("COURSE_SLUG").unwrap_or_else(|_| "algorithms-searching-sorting-indexing".into());
        let raw = crate::auth::read_cookies().expect("saved cookies");
        let client = crate::client::CourseraClient::new(&raw).expect("client");
        let o = super::fetch_outline(&client, &slug, " - ").await.expect("outline");
        println!("{} | {:?} | modules={}", o.name, o.partner_name, o.modules.len());
        for m in &o.modules {
            for l in &m.lessons {
                for it in &l.items {
                    if let Some(p) = it.video.as_ref().or(it.reading.as_ref()) {
                        println!("FILE {}", p);
                    }
                }
            }
        }
    }
}
