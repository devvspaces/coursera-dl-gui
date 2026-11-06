import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileWarning,
  Loader2,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  courseFileUrl,
  isLocal,
  isStreamable,
  itemKind,
  itemKindLabel,
  joinPath,
  type CourseOutline,
  type CourseProgress,
  type FlatItem,
} from "@/lib/course";
import { parseSubtitles, type Cue } from "@/lib/subtitles";
import { useAppStore } from "@/store/useAppStore";
import { VideoPlayer, type VideoController } from "@/components/player/VideoPlayer";
import { Transcript } from "@/components/player/Transcript";
import { ReadingView } from "@/components/player/ReadingView";
import { ItemRow, itemMeta } from "@/components/player/parts";

interface ItemViewProps {
  outline: CourseOutline;
  flat: FlatItem[];
  current: FlatItem;
  progress: CourseProgress;
  onOpenItem: (id: string) => void;
  onOpenModule: (index: number) => void;
  onComplete: (id: string, done: boolean) => void;
  onPosition: (id: string, seconds: number) => void;
}

export function ItemView({ outline, flat, current, progress, onOpenItem, onOpenModule, onComplete, onPosition }: ItemViewProps) {
  const [menuOpen, setMenuOpen] = useState(true);
  const { item, module, moduleIndex } = current;
  const idx = flat.findIndex((f) => f.item.id === item.id);
  const prev = idx > 0 ? flat[idx - 1] : null;
  const next = idx >= 0 && idx < flat.length - 1 ? flat[idx + 1] : null;
  const done = Boolean(progress.completed[item.id]);
  const kind = itemKind(item.item_type);
  const local = isLocal(item);
  const canStream = !local && isStreamable(outline, item);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [item.id]);

  return (
    <div className="flex h-full min-h-0">
      {/* Lesson outline for the current module */}
      {menuOpen && (
        <aside className="w-[300px] shrink-0 border-r border-border bg-card overflow-y-auto custom-scrollbar">
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <button onClick={() => onOpenModule(moduleIndex)} className="text-left cursor-pointer group">
              <div className="text-xs text-muted-foreground">Module {moduleIndex + 1}</div>
              <div className="text-sm font-semibold text-foreground group-hover:text-primary line-clamp-2">{module.name}</div>
            </button>
            <button
              onClick={() => setMenuOpen(false)}
              className="h-8 w-8 rounded-md hover:bg-secondary flex items-center justify-center shrink-0 cursor-pointer"
              title="Hide menu"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </div>
          <div className="pb-6">
            {module.lessons.map((lesson) => (
              <div key={lesson.id} className="mt-3">
                <div className="px-4 py-1.5 text-[13px] font-semibold text-foreground/80">{lesson.name}</div>
                {lesson.items.map((it) => (
                  <ItemRow
                    key={it.id}
                    item={it}
                    compact
                    active={it.id === item.id}
                    done={Boolean(progress.completed[it.id])}
                    preview={outline.preview}
                    onClick={() => onOpenItem(it.id)}
                  />
                ))}
              </div>
            ))}
          </div>
        </aside>
      )}

      {/* Content */}
      <div ref={scrollRef} className="flex-1 min-w-0 overflow-y-auto custom-scrollbar">
        <div className="max-w-[980px] mx-auto px-8 py-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
            {!menuOpen && (
              <button
                onClick={() => setMenuOpen(true)}
                className="h-8 w-8 -ml-2 rounded-md hover:bg-secondary flex items-center justify-center cursor-pointer"
                title="Show menu"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </button>
            )}
            <button onClick={() => onOpenModule(moduleIndex)} className="hover:underline hover:text-foreground cursor-pointer">
              Module {moduleIndex + 1}
            </button>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="truncate">{current.lesson.name}</span>
          </div>

          {kind === "video" && (local || canStream) ? (
            <VideoItem
              key={item.id}
              outline={outline}
              current={current}
              remote={!local}
              startAt={progress.positions[item.id] || 0}
              onPosition={(s) => onPosition(item.id, s)}
              onNearlyDone={() => !done && onComplete(item.id, true)}
              onEnded={() => {
                if (useAppStore.getState().playerPrefs.autoplayNext && next) onOpenItem(next.item.id);
              }}
            />
          ) : kind === "reading" && (local || canStream) ? (
            <div>
              <h1 className="text-[28px] font-semibold text-foreground leading-tight">{item.name}</h1>
              <div className="text-sm text-muted-foreground mt-1 mb-6 flex items-center gap-2">
                {itemMeta(item)}
                {!local && <StreamingBadge />}
              </div>
              <ReadingView outline={outline} item={item} />
            </div>
          ) : (
            <UnavailableItem current={current} preview={outline.preview} />
          )}

          {/* Footer: completion + navigation */}
          <div className="mt-10 pt-6 border-t border-border flex items-center justify-between gap-4">
            <button
              onClick={() => onComplete(item.id, !done)}
              className={cn(
                "inline-flex items-center gap-2 h-10 px-4 rounded-md text-sm font-semibold transition-colors cursor-pointer",
                done
                  ? "text-[#1F8354] bg-[#1F8354]/10 hover:bg-[#1F8354]/15"
                  : "border border-primary text-primary hover:bg-primary/5"
              )}
            >
              <CheckCircle2 className={cn("h-4 w-4", done && "fill-[#1F8354] text-white")} />
              {done ? "Completed" : "Mark as completed"}
            </button>
            <div className="flex items-center gap-2">
              <NavButton disabled={!prev} onClick={() => prev && onOpenItem(prev.item.id)} label="Previous" icon="left" />
              <NavButton disabled={!next} onClick={() => next && onOpenItem(next.item.id)} label="Go to next item" icon="right" primary />
            </div>
          </div>
          {next && (
            <div className="mt-3 text-right text-xs text-muted-foreground">
              Up next: <span className="text-foreground">{next.item.name}</span> • {itemKindLabel(next.item.item_type)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function VideoItem({
  outline,
  current,
  remote,
  startAt,
  onPosition,
  onNearlyDone,
  onEnded,
}: {
  outline: CourseOutline;
  current: FlatItem;
  remote: boolean;
  startAt: number;
  onPosition: (s: number) => void;
  onNearlyDone: () => void;
  onEnded: () => void;
}) {
  const { item } = current;
  const [cues, setCues] = useState<Cue[] | null>(null);
  const [time, setTime] = useState(0);
  const [query, setQuery] = useState("");
  const controller = useRef<VideoController | null>(null);
  const lastSaved = useRef(0);
  const nearlyDoneFired = useRef(false);
  const prefs = useAppStore((s) => s.playerPrefs);
  const setPrefs = useAppStore((s) => s.setPlayerPrefs);

  const track = item.subtitles.find((s) => s.lang === "en") || item.subtitles[0];
  const maxResolution = useAppStore((s) => s.maxResolution);
  const [remoteSrc, setRemoteSrc] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCues(null);
    setRemoteSrc(null);
    setStreamError(null);
    if (remote) {
      invoke<{ video_url: string; subtitles?: string | null }>("get_lecture_stream", {
        courseId: outline.course_id,
        itemId: item.id,
        maxResolution,
      })
        .then((s) => {
          if (cancelled) return;
          setRemoteSrc(s.video_url);
          setCues(s.subtitles ? parseSubtitles(s.subtitles) : []);
        })
        .catch((e) => !cancelled && setStreamError(String(e)));
    } else if (track) {
      invoke<string>("read_course_file", { path: joinPath(outline.course_dir, track.path) })
        .then((txt) => !cancelled && setCues(parseSubtitles(txt)))
        .catch(() => !cancelled && setCues([]));
    } else {
      setCues([]);
    }
    return () => {
      cancelled = true;
    };
  }, [remote, outline.course_dir, outline.course_id, item.id, track?.path, maxResolution]);

  const src = remote ? remoteSrc : courseFileUrl(outline, item.video!);

  return (
    <div>
      {!src ? (
        <div className="w-full aspect-video rounded-lg bg-black flex items-center justify-center text-white/80 text-sm gap-2 px-8 text-center">
          {streamError ? (
            streamError
          ) : (
            <>
              <Loader2 className="h-5 w-5 animate-spin" /> Loading video from Coursera…
            </>
          )}
        </div>
      ) : (
      <VideoPlayer
        src={src}
        cues={cues}
        startAt={startAt}
        controllerRef={controller}
        onTime={(t, d) => {
          setTime(t);
          if (Math.abs(t - lastSaved.current) >= 5) {
            lastSaved.current = t;
            onPosition(t);
          }
          if (!nearlyDoneFired.current && d > 0 && t / d >= 0.9) {
            nearlyDoneFired.current = true;
            onNearlyDone();
          }
        }}
        onEnded={() => {
          onPosition(0);
          onEnded();
        }}
      />
      )}

      <div className="mt-5">
        <h1 className="text-[26px] font-semibold text-foreground leading-tight">{item.name}</h1>
        <div className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
          {itemMeta(item)}
          {remote && <StreamingBadge />}
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border">
          <h2 className="text-base font-semibold">Transcript</h2>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={prefs.transcriptAutoScroll}
                onChange={(e) => setPrefs({ transcriptAutoScroll: e.target.checked })}
                className="accent-[#0056D2]"
              />
              Auto-scroll
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={prefs.autoplayNext}
                onChange={(e) => setPrefs({ autoplayNext: e.target.checked })}
                className="accent-[#0056D2]"
              />
              Autoplay next
            </label>
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search transcript"
                className="h-8 w-44 rounded-md border border-input bg-background pl-8 pr-2 text-xs outline-none focus:border-primary"
              />
            </div>
          </div>
        </div>
        <div className="px-5 py-4">
          {cues === null && (track || remote) ? (
            <div className="text-sm text-muted-foreground">Loading transcript…</div>
          ) : cues && cues.length > 0 ? (
            <Transcript
              cues={cues}
              currentTime={time}
              onSeek={(t) => {
                controller.current?.seek(t);
                controller.current?.play();
              }}
              autoScroll={prefs.transcriptAutoScroll}
              query={query}
            />
          ) : (
            <div className="text-sm text-muted-foreground">No transcript was downloaded for this video.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function StreamingBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#E8F0FE] dark:bg-[#1E223D] text-[#0056D2] dark:text-[#93B8FF] px-2 py-0.5 text-[11px] font-semibold">
      Streaming online
    </span>
  );
}

function UnavailableItem({ current, preview }: { current: FlatItem; preview: boolean }) {
  const { item } = current;
  const setActiveView = useAppStore((s) => s.setActiveView);
  const downloadable = Boolean(item.video || item.reading) && !preview;
  if (item.locked && (item.item_type === "lecture" || item.item_type === "supplement")) {
    return (
      <div>
        <h1 className="text-[28px] font-semibold text-foreground leading-tight">{item.name}</h1>
        <div className="text-sm text-muted-foreground mt-1 mb-6">{itemMeta(item)}</div>
        <div className="rounded-xl border border-border bg-card p-8 flex flex-col items-start gap-4">
          <Lock className="h-8 w-8 text-muted-foreground" />
          <p className="text-[15px] text-foreground/90">
            This item is locked for your account. Enroll in the course on Coursera to unlock it.
          </p>
          <button
            onClick={() => openUrl(item.url).catch(console.error)}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-md bg-[#0056D2] hover:bg-[#00419e] text-white text-sm font-semibold cursor-pointer"
          >
            <ExternalLink className="h-4 w-4" /> Open on Coursera
          </button>
        </div>
      </div>
    );
  }
  return (
    <div>
      <h1 className="text-[28px] font-semibold text-foreground leading-tight">{item.name}</h1>
      <div className="text-sm text-muted-foreground mt-1 mb-6">{itemMeta(item)}</div>
      <div className="rounded-xl border border-border bg-card p-8 flex flex-col items-start gap-4">
        <FileWarning className="h-8 w-8 text-muted-foreground" />
        {downloadable ? (
          <>
            <p className="text-[15px] text-foreground/90">
              This {itemKindLabel(item.item_type).toLowerCase()} hasn't been downloaded yet.
            </p>
            <button
              onClick={() => setActiveView("downloads")}
              className="h-10 px-4 rounded-md bg-[#0056D2] hover:bg-[#00419e] text-white text-sm font-semibold cursor-pointer"
            >
              Go to Downloads
            </button>
          </>
        ) : (
          <>
            <p className="text-[15px] text-foreground/90">
              {itemKindLabel(item.item_type)}s can't be taken offline. Open it on Coursera to complete it.
            </p>
            <button
              onClick={() => openUrl(item.url).catch(console.error)}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-md bg-[#0056D2] hover:bg-[#00419e] text-white text-sm font-semibold cursor-pointer"
            >
              <ExternalLink className="h-4 w-4" /> Open on Coursera
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function NavButton({
  disabled,
  onClick,
  label,
  icon,
  primary,
}: {
  disabled: boolean;
  onClick: () => void;
  label: string;
  icon: "left" | "right";
  primary?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 h-10 px-4 rounded-md text-sm font-semibold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
        primary ? "bg-[#0056D2] hover:bg-[#00419e] text-white" : "border border-border hover:bg-secondary text-foreground"
      )}
    >
      {icon === "left" && <ChevronLeft className="h-4 w-4" />}
      {label}
      {icon === "right" && <ChevronRight className="h-4 w-4" />}
    </button>
  );
}
