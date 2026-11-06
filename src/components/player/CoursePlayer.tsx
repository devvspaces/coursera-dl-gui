import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  BookmarkCheck,
  BookmarkPlus,
  ChevronDown,
  Download,
  Globe,
  ChevronUp,
  FolderOpen,
  Info,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  emptyProgress,
  flattenItems,
  formatDuration,
  itemKindLabel,
  moduleStats,
  type CourseOutline,
  type CourseProgress,
  type FlatItem,
} from "@/lib/course";
import { useAppStore, type CourseManifest } from "@/store/useAppStore";
import { CachedImage } from "@/components/CachedImage";
import { ModuleOverview } from "@/components/player/ModuleOverview";
import { ItemView } from "@/components/player/ItemView";
import { ItemIcon, ProgressRing } from "@/components/player/parts";

type Route = { kind: "module"; index: number } | { kind: "item"; id: string } | { kind: "info" };

export function CoursePlayer() {
  const ref = useAppStore((s) => s.playerCourse);
  const closeCoursePlayer = useAppStore((s) => s.closeCoursePlayer);
  const maxResolution = useAppStore((s) => s.maxResolution);
  const setActiveManifest = useAppStore((s) => s.setActiveManifest);
  const setActiveView = useAppStore((s) => s.setActiveView);

  const [outline, setOutline] = useState<CourseOutline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<CourseProgress>(emptyProgress());
  const [route, setRoute] = useState<Route>({ kind: "module", index: 0 });
  const [materialOpen, setMaterialOpen] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildMsg, setRebuildMsg] = useState<{ missing: number; error?: string } | null>(null);

  const courseKey = outline ? outline.slug || outline.course_dir.split("/").pop() || "course" : null;

  // ── Load outline + progress ───────────────────────────────────────────
  useEffect(() => {
    if (!ref) return;
    let cancelled = false;
    setOutline(null);
    setError(null);
    const load =
      ref.mode === "preview"
        ? invoke<CourseOutline>("get_course_preview", { slug: ref.slug })
        : invoke<CourseOutline>("get_course_outline", { path: ref.path });
    load
      .then(async (o) => {
        if (cancelled) return;
        setOutline(o);
        const key = o.slug || o.course_dir.split("/").pop() || "course";
        const p = await invoke<Partial<CourseProgress>>("get_course_progress", { courseKey: key }).catch(() => ({}));
        if (cancelled) return;
        const loaded = { ...emptyProgress(), ...p };
        setProgress(loaded);
        // Open the module containing the last viewed item (Coursera lands you on the module page)
        const flat = flattenItems(o);
        const last = flat.find((f) => f.item.id === loaded.lastItemId);
        setRoute({ kind: "module", index: last ? last.moduleIndex : 0 });
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [ref?.path, ref?.slug, ref?.mode]);

  // ── Persist progress (debounced) ──────────────────────────────────────
  const saveTimer = useRef<number | undefined>(undefined);
  const latestProgress = useRef(progress);
  latestProgress.current = progress;
  const persist = useCallback(() => {
    if (!courseKey) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      invoke("save_course_progress", { courseKey, progress: latestProgress.current }).catch(console.error);
    }, 600);
  }, [courseKey]);

  useEffect(
    () => () => {
      // flush on unmount
      window.clearTimeout(saveTimer.current);
      if (courseKey) invoke("save_course_progress", { courseKey, progress: latestProgress.current }).catch(() => {});
    },
    [courseKey]
  );

  const updateProgress = useCallback(
    (fn: (p: CourseProgress) => CourseProgress) => {
      setProgress((p) => {
        const next = fn(p);
        latestProgress.current = next;
        return next;
      });
      persist();
    },
    [persist]
  );

  const flat = useMemo(() => (outline ? flattenItems(outline) : []), [outline]);
  const currentItem: FlatItem | null =
    route.kind === "item" ? flat.find((f) => f.item.id === route.id) ?? null : null;

  const openItem = useCallback(
    (id: string) => {
      setRoute({ kind: "item", id });
      updateProgress((p) => ({ ...p, lastItemId: id }));
    },
    [updateProgress]
  );

  const setCompleted = useCallback(
    (id: string, done: boolean) =>
      updateProgress((p) => {
        const completed = { ...p.completed };
        if (done) completed[id] = true;
        else delete completed[id];
        return { ...p, completed };
      }),
    [updateProgress]
  );

  const setPosition = useCallback(
    (id: string, seconds: number) =>
      updateProgress((p) => ({ ...p, positions: { ...p.positions, [id]: Math.floor(seconds) } })),
    [updateProgress]
  );

  const rebuild = async () => {
    if (!outline) return;
    setRebuilding(true);
    setRebuildMsg(null);
    try {
      const res = await invoke<{ outline: CourseOutline; manifest: CourseManifest }>("rebuild_course_metadata", {
        path: outline.course_dir,
        slug: ref?.slug || (outline.inferred ? null : outline.slug) || null,
        maxResolution,
      });
      setOutline(res.outline);
      const missing = res.manifest.tasks.filter((t) => t.status !== "completed").length;
      setActiveManifest(res.manifest);
      setRebuildMsg({ missing });
    } catch (e) {
      setRebuildMsg({ missing: 0, error: String(e) });
    } finally {
      setRebuilding(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────
  if (!ref) {
    return (
      <div className="h-screen flex items-center justify-center text-muted-foreground">
        No course selected.{" "}
        <button className="text-primary underline ml-1" onClick={closeCoursePlayer}>
          Back to library
        </button>
      </div>
    );
  }

  const overall = (() => {
    const total = flat.length;
    const done = flat.filter((f) => progress.completed[f.item.id]).length;
    return { total, done, pct: total ? done / total : 0 };
  })();
  const resume = flat.find((f) => f.item.id === progress.lastItemId) ?? null;

  return (
    <div className="h-screen w-screen flex flex-col bg-[#F5F7FA] dark:bg-background text-foreground overflow-hidden">
      <TopBar
        outline={outline}
        flat={flat}
        onBack={closeCoursePlayer}
        onOpenItem={openItem}
        onHome={() => setRoute({ kind: "module", index: currentItem?.moduleIndex ?? 0 })}
      />

      {error ? (
        <div className="flex-1 flex items-center justify-center p-10">
          <div className="max-w-md text-center space-y-3">
            <p className="text-destructive font-medium">Could not open this course</p>
            <p className="text-sm text-muted-foreground break-all">{error}</p>
            <button onClick={closeCoursePlayer} className="text-primary text-sm font-semibold hover:underline">
              Back to library
            </button>
          </div>
        </div>
      ) : !outline ? (
        <div className="flex-1 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Opening course…
        </div>
      ) : route.kind === "item" && currentItem ? (
        <div className="flex-1 min-h-0">
          <ItemView
            outline={outline}
            flat={flat}
            current={currentItem}
            progress={progress}
            onOpenItem={openItem}
            onOpenModule={(index) => setRoute({ kind: "module", index })}
            onComplete={setCompleted}
            onPosition={setPosition}
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          <div className="max-w-[1400px] mx-auto flex gap-6 px-5 py-5">
            {/* Left: course navigation */}
            <aside className="w-[300px] shrink-0 self-start sticky top-5 rounded-2xl bg-card border border-border/60 px-3 py-6">
              <div className="px-3">
                {(outline.partner_logo || outline.partner_name) && (
                  <div className="flex items-center gap-3 mb-3">
                    {outline.partner_logo && (
                      <img src={outline.partner_logo} alt="" className="h-12 w-12 rounded border border-border object-contain bg-white p-0.5" />
                    )}
                    {outline.partner_name && <span className="text-[15px] text-foreground/80 leading-snug">{outline.partner_name}</span>}
                  </div>
                )}
                <h2 className="text-xl font-semibold leading-snug text-foreground">{outline.name}</h2>
              </div>

              <div className="mt-8">
                <button
                  onClick={() => setMaterialOpen((o) => !o)}
                  className="w-full flex items-center justify-between px-3 py-2 text-[17px] font-semibold cursor-pointer"
                >
                  Course Material
                  {materialOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                {materialOpen && (
                  <nav className="mt-1 space-y-0.5">
                    {outline.modules.map((m, i) => {
                      const s = moduleStats(m, progress);
                      const active = route.kind === "module" && route.index === i;
                      return (
                        <button
                          key={m.id}
                          onClick={() => setRoute({ kind: "module", index: i })}
                          title={m.name}
                          className={cn(
                            "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-[15px] cursor-pointer transition-colors",
                            active ? "bg-[#F0F6FF] dark:bg-[#1E223D] font-semibold" : "hover:bg-secondary/60"
                          )}
                        >
                          <ProgressRing value={s.total ? s.done / s.total : 0} size={20} />
                          <span className="truncate">Module {i + 1}</span>
                        </button>
                      );
                    })}
                  </nav>
                )}
              </div>

              <button
                onClick={() => setRoute({ kind: "info" })}
                className={cn(
                  "mt-4 w-full flex items-center px-3 py-2.5 rounded-lg text-left text-[17px] cursor-pointer",
                  route.kind === "info" ? "bg-[#F0F6FF] dark:bg-[#1E223D] font-semibold" : "hover:bg-secondary/60"
                )}
              >
                Course Info
              </button>
            </aside>

            {/* Center */}
            <main className="flex-1 min-w-0 space-y-5">
              {outline.preview && <PreviewBanner outline={outline} flat={flat} />}
              {outline.inferred && !outline.preview && (
                <InferredBanner rebuilding={rebuilding} onRebuild={rebuild} />
              )}
              {rebuildMsg && (
                <RebuildNotice
                  msg={rebuildMsg}
                  onDismiss={() => setRebuildMsg(null)}
                  onDownload={() => setActiveView("downloads")}
                />
              )}

              {route.kind === "info" ? (
                <CourseInfo
                  outline={outline}
                  overall={overall}
                  rebuilding={rebuilding}
                  onRebuild={outline.preview ? undefined : rebuild}
                />
              ) : outline.modules.length === 0 ? (
                <div className="rounded-2xl bg-card border border-border/60 p-10 text-muted-foreground">
                  No course material was found in this folder.
                </div>
              ) : (
                <ModuleOverview
                  module={outline.modules[Math.min(route.kind === "module" ? route.index : 0, outline.modules.length - 1)]}
                  moduleIndex={Math.min(route.kind === "module" ? route.index : 0, outline.modules.length - 1)}
                  progress={progress}
                  resume={resume}
                  preview={outline.preview}
                  onOpenItem={openItem}
                />
              )}
            </main>

            {/* Right: progress summary */}
            <aside className="w-[300px] shrink-0 self-start sticky top-5 space-y-5 hidden xl:block">
              <div className="rounded-2xl bg-card border border-border/60 p-6">
                <h3 className="text-[17px] font-semibold">Your progress</h3>
                <div className="mt-4 flex items-center gap-4">
                  <ProgressRing value={overall.pct} size={56} />
                  <div>
                    <div className="text-2xl font-semibold tabular-nums">{Math.round(overall.pct * 100)}%</div>
                    <div className="text-sm text-muted-foreground">
                      {overall.done} of {overall.total} items completed
                    </div>
                  </div>
                </div>
                <div className="mt-5 h-2 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full bg-[#1F8354] rounded-full transition-all" style={{ width: `${overall.pct * 100}%` }} />
                </div>
              </div>

              <div className="rounded-2xl bg-card border border-border/60 p-6">
                <h3 className="text-[17px] font-semibold">{outline.preview ? "Online preview" : "Offline library"}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-6">
                  {outline.preview
                    ? "Items you haven't downloaded stream from Coursera; downloaded ones play from your disk. Download the course to keep it offline."
                    : "Videos, transcripts and readings play straight from your disk — no internet needed. Quizzes and assignments open on Coursera."}
                </p>
                {outline.workload && <p className="mt-3 text-sm text-foreground/80">Workload: {outline.workload}</p>}
              </div>
            </aside>
          </div>
        </div>
      )}
    </div>
  );
}

function TopBar({
  outline,
  flat,
  onBack,
  onOpenItem,
  onHome,
}: {
  outline: CourseOutline | null;
  flat: FlatItem[];
  onBack: () => void;
  onOpenItem: (id: string) => void;
  onHome: () => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const q = query.trim().toLowerCase();
  const results = q
    ? flat
        .filter(
          (f) =>
            f.item.name.toLowerCase().includes(q) ||
            f.lesson.name.toLowerCase().includes(q) ||
            f.module.name.toLowerCase().includes(q)
        )
        .slice(0, 12)
    : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const choose = (id: string) => {
    onOpenItem(id);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  };

  return (
    <header className="h-16 shrink-0 bg-card border-b border-border flex items-center gap-4 px-5 relative z-30">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-2 h-9 px-2.5 rounded-md text-sm font-semibold text-foreground hover:bg-secondary cursor-pointer"
        title="Back to library"
      >
        <ArrowLeft className="h-4 w-4" /> Library
      </button>
      <div className="h-8 w-px bg-border" />
      <button onClick={onHome} className="flex items-center gap-3 min-w-0 cursor-pointer" title="Course home">
        <div className="h-10 w-[72px] rounded overflow-hidden shrink-0 border border-border">
          <CachedImage src={outline?.photo_url} alt={outline?.name || "Course"} className="w-full h-full object-cover" />
        </div>
        <span className="font-semibold text-[15px] truncate max-w-[260px] hidden lg:block">{outline?.name}</span>
      </button>

      <div className="relative flex-1 max-w-[560px] ml-2">
        <div className="flex">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results[0]) choose(results[0].item.id);
            }}
            placeholder="Search in course"
            className="h-11 flex-1 rounded-l-md border border-r-0 border-[#5F5F5F]/60 dark:border-white/20 bg-background px-4 text-[15px] outline-none focus:border-primary"
          />
          <button
            onClick={() => results[0] && choose(results[0].item.id)}
            className="h-11 px-5 rounded-r-md bg-[#0056D2] hover:bg-[#00419e] text-white text-[15px] font-semibold inline-flex items-center gap-2 cursor-pointer"
          >
            <Search className="h-4 w-4 lg:hidden" />
            <span className="hidden lg:inline">Search</span>
          </button>
        </div>
        {open && q && (
          <div className="absolute top-12 left-0 right-0 rounded-lg border border-border bg-card shadow-xl max-h-[420px] overflow-y-auto custom-scrollbar py-1">
            {results.length === 0 ? (
              <div className="px-4 py-3 text-sm text-muted-foreground">No matching items</div>
            ) : (
              results.map((r) => (
                <button
                  key={r.item.id}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(r.item.id)}
                  className="w-full flex items-start gap-3 px-4 py-2.5 hover:bg-secondary text-left cursor-pointer"
                >
                  <ItemIcon item={r.item} className="h-4.5 w-4.5 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-sm text-foreground truncate">{r.item.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      Module {r.moduleIndex + 1} • {r.lesson.name} • {itemKindLabel(r.item.item_type)}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </header>
  );
}

function PreviewBanner({ outline, flat }: { outline: CourseOutline; flat: FlatItem[] }) {
  const bookmarks = useAppStore((s) => s.bookmarks);
  const toggleBookmark = useAppStore((s) => s.toggleBookmark);
  const maxResolution = useAppStore((s) => s.maxResolution);
  const setActiveManifest = useAppStore((s) => s.setActiveManifest);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const [preparing, setPreparing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const downloadable = flat.filter((f) => f.item.video || f.item.reading);
  const local = downloadable.filter((f) => f.item.available).length;
  const saved = bookmarks.some((b) => b.kind === "course" && b.slug === outline.slug);

  const download = async () => {
    setPreparing(true);
    setErr(null);
    try {
      const manifest = await invoke<CourseManifest>("prepare_course_download", {
        slug: outline.slug,
        isSpec: false,
        prefixSep: " - ",
        maxResolution,
      });
      setActiveManifest(manifest);
      setActiveView("downloads");
    } catch (e) {
      setErr(String(e));
    } finally {
      setPreparing(false);
    }
  };

  return (
    <div className="rounded-2xl bg-[#E8F0FE] dark:bg-[#1E223D] px-7 py-5 flex items-start gap-4">
      <Globe className="h-6 w-6 text-[#0056D2] dark:text-[#93B8FF] shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-[17px]">Previewing online</div>
        <p className="text-[15px] text-foreground/80 mt-1 leading-6">
          {local === 0
            ? "None of this course is downloaded yet — videos and readings stream from Coursera."
            : local >= downloadable.length
              ? "Everything is downloaded and plays from your disk."
              : `${local} of ${downloadable.length} videos and readings are downloaded; the rest stream from Coursera.`}
        </p>
        {err && <p className="text-sm text-destructive mt-2">{err}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {local < downloadable.length && (
            <button
              onClick={download}
              disabled={preparing}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-md bg-[#0056D2] hover:bg-[#00419e] text-white text-sm font-semibold disabled:opacity-60 cursor-pointer"
            >
              {preparing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {preparing ? "Preparing…" : local > 0 ? "Download the rest" : "Download course"}
            </button>
          )}
          <button
            onClick={() =>
              toggleBookmark({
                kind: "course",
                label: "Course",
                slug: outline.slug,
                name: outline.name,
                photo_url: outline.photo_url,
                partner_name: outline.partner_name,
              })
            }
            className="inline-flex items-center gap-2 h-10 px-4 rounded-md border border-[#0056D2]/40 text-[#0056D2] dark:text-[#93B8FF] bg-white/60 dark:bg-transparent hover:bg-white text-sm font-semibold cursor-pointer"
          >
            {saved ? <BookmarkCheck className="h-4 w-4" /> : <BookmarkPlus className="h-4 w-4" />}
            {saved ? "Saved" : "Save for later"}
          </button>
        </div>
      </div>
    </div>
  );
}

function InferredBanner({ rebuilding, onRebuild }: { rebuilding: boolean; onRebuild: () => void }) {
  return (
    <div className="rounded-2xl bg-[#E8F0FE] dark:bg-[#1E223D] px-7 py-5 flex items-start gap-4">
      <Info className="h-6 w-6 text-[#0056D2] dark:text-[#93B8FF] shrink-0 mt-0.5" />
      <div className="flex-1">
        <div className="font-semibold text-[17px]">Sync course details from Coursera</div>
        <p className="text-[15px] text-foreground/80 mt-1 leading-6">
          This course was downloaded before course details were saved, so titles come from folder names. Sync once to get
          real module names, descriptions, durations, quizzes and reading images. Your videos won't be downloaded again.
        </p>
        <button
          onClick={onRebuild}
          disabled={rebuilding}
          className="mt-3 inline-flex items-center gap-2 h-10 px-4 rounded-md bg-[#0056D2] hover:bg-[#00419e] text-white text-sm font-semibold disabled:opacity-60 cursor-pointer"
        >
          {rebuilding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {rebuilding ? "Syncing…" : "Sync course details"}
        </button>
      </div>
    </div>
  );
}

function RebuildNotice({
  msg,
  onDismiss,
  onDownload,
}: {
  msg: { missing: number; error?: string };
  onDismiss: () => void;
  onDownload: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl px-7 py-4 flex items-center gap-4",
        msg.error ? "bg-destructive/10 text-destructive" : "bg-[#E6F4EA] dark:bg-emerald-950/40 text-[#1F1F1F] dark:text-emerald-100"
      )}
    >
      <div className="flex-1 text-[15px]">
        {msg.error
          ? `Sync failed: ${msg.error}`
          : msg.missing > 0
            ? `Course details updated. ${msg.missing} file${msg.missing === 1 ? " is" : "s are"} not on disk yet (reading images, attachments or new items).`
            : "Course details updated. Everything is already downloaded."}
      </div>
      {!msg.error && msg.missing > 0 && (
        <button
          onClick={onDownload}
          className="h-9 px-4 rounded-md bg-[#0056D2] hover:bg-[#00419e] text-white text-sm font-semibold cursor-pointer"
        >
          Download missing files
        </button>
      )}
      <button onClick={onDismiss} className="h-8 w-8 rounded-md hover:bg-black/5 flex items-center justify-center cursor-pointer" aria-label="Dismiss">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function CourseInfo({
  outline,
  overall,
  rebuilding,
  onRebuild,
}: {
  outline: CourseOutline;
  overall: { total: number; done: number };
  rebuilding: boolean;
  onRebuild?: () => void;
}) {
  const counts = flattenItems(outline).reduce(
    (acc, f) => {
      const k = f.item.item_type === "lecture" ? "videos" : f.item.item_type === "supplement" ? "readings" : "other";
      acc[k] += 1;
      acc.ms += f.item.duration_ms;
      return acc;
    },
    { videos: 0, readings: 0, other: 0, ms: 0 }
  );
  return (
    <section className="rounded-2xl bg-card border border-border/60 px-10 py-9 space-y-6">
      <div>
        <div className="text-sm text-muted-foreground">{outline.partner_name}</div>
        <h1 className="text-[26px] font-semibold leading-tight">{outline.name}</h1>
      </div>
      {outline.description && (
        <div>
          <h2 className="text-lg font-semibold mb-2">About this course</h2>
          <p className="text-[16px] leading-7 text-foreground/90 whitespace-pre-line">{outline.description}</p>
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Modules" value={outline.modules.length} />
        <Stat label="Videos" value={counts.videos} />
        <Stat label="Readings" value={counts.readings} />
        <Stat label="Total time" value={formatDuration(counts.ms) || "—"} />
      </div>
      <div className="text-sm text-muted-foreground">
        {overall.done} of {overall.total} items completed
      </div>
      {outline.course_dir && (
        <div className="pt-4 border-t border-border flex flex-wrap items-center gap-3">
          <button
            onClick={() => invoke("open_download_folder", { path: outline.course_dir }).catch(console.error)}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-md border border-border hover:bg-secondary text-sm font-semibold cursor-pointer"
          >
            <FolderOpen className="h-4 w-4 text-primary" /> Show in Finder
          </button>
          {onRebuild && (
            <button
              onClick={onRebuild}
              disabled={rebuilding}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-md border border-border hover:bg-secondary text-sm font-semibold disabled:opacity-60 cursor-pointer"
            >
              {rebuilding ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4 text-primary" />}
              Sync course details
            </button>
          )}
          <span className="text-xs font-mono text-muted-foreground break-all">{outline.course_dir}</span>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl bg-secondary/50 px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
