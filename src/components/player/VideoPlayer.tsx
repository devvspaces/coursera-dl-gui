import { useCallback, useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Captions,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatClock } from "@/lib/course";
import { activeCueIndex, type Cue } from "@/lib/subtitles";
import { useAppStore } from "@/store/useAppStore";
import { getCurrentWindow } from "@tauri-apps/api/window";

export interface VideoController {
  seek: (t: number) => void;
  play: () => void;
  pause: () => void;
}

interface VideoPlayerProps {
  src: string;
  cues: Cue[] | null;
  startAt?: number;
  controllerRef?: React.MutableRefObject<VideoController | null>;
  onTime?: (t: number, duration: number) => void;
  onEnded?: () => void;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

export function VideoPlayer({ src, cues, startAt = 0, controllerRef, onTime, onEnded }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const prefs = useAppStore((s) => s.playerPrefs);
  const setPrefs = useAppStore((s) => s.setPlayerPrefs);

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffering, setBuffering] = useState(true);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);

  const v = () => videoRef.current;

  const seek = useCallback((t: number) => {
    const el = v();
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(t, el.duration || t));
    setTime(el.currentTime);
  }, []);

  const togglePlay = useCallback(() => {
    const el = v();
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  }, []);

  useEffect(() => {
    if (controllerRef) {
      controllerRef.current = {
        seek,
        play: () => v()?.play().catch(() => {}),
        pause: () => v()?.pause(),
      };
    }
  }, [controllerRef, seek]);

  // Apply remembered speed whenever the source changes
  useEffect(() => {
    const el = v();
    if (el) el.playbackRate = prefs.playbackRate;
  }, [src, prefs.playbackRate]);

  useEffect(() => {
    setError(null);
    setBuffering(true);
    setTime(0);
  }, [src]);

  // WKWebView (Tauri on macOS) doesn't support element fullscreen, so we make the native window
  // fullscreen and pin the player over the whole page.
  const fullscreenRef = useRef(false);
  const setWindowFullscreen = useCallback((next: boolean) => {
    fullscreenRef.current = next;
    setFullscreen(next);
    getCurrentWindow()
      .setFullscreen(next)
      .catch((e) => console.error("setFullscreen failed", e));
  }, []);

  const toggleFullscreen = useCallback(() => setWindowFullscreen(!fullscreenRef.current), [setWindowFullscreen]);

  useEffect(() => {
    // Resync if the user leaves fullscreen with the green traffic light / Ctrl+Cmd+F
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    win
      .onResized(async () => {
        const isFs = await win.isFullscreen().catch(() => fullscreenRef.current);
        if (!isFs && fullscreenRef.current) {
          fullscreenRef.current = false;
          setFullscreen(false);
        }
      })
      .then((fn) => (unlisten = fn))
      .catch(() => {});
    return () => {
      unlisten?.();
      if (fullscreenRef.current) win.setFullscreen(false).catch(() => {});
    };
  }, []);

  const showFlash = (msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash((f) => (f === msg ? null : f)), 700);
  };

  const changeSpeed = useCallback(
    (dir: 1 | -1) => {
      const i = SPEEDS.indexOf(prefs.playbackRate);
      const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i === -1 ? 2 : i) + dir))];
      setPrefs({ playbackRate: next });
      showFlash(`${next}x`);
    },
    [prefs.playbackRate, setPrefs]
  );

  // Keyboard shortcuts (YouTube/Coursera style)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = v();
      if (!el) return;
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
        case "j":
          e.preventDefault();
          seek(el.currentTime - (e.key === "j" ? 10 : 5));
          showFlash(e.key === "j" ? "-10s" : "-5s");
          break;
        case "ArrowRight":
        case "l":
          e.preventDefault();
          seek(el.currentTime + (e.key === "l" ? 10 : 5));
          showFlash(e.key === "l" ? "+10s" : "+5s");
          break;
        case "f":
          toggleFullscreen();
          break;
        case "Escape":
          if (fullscreenRef.current) setWindowFullscreen(false);
          break;
        case "m":
          el.muted = !el.muted;
          setMuted(el.muted);
          break;
        case "c":
          setPrefs({ captionsEnabled: !useAppStore.getState().playerPrefs.captionsEnabled });
          break;
        case ">":
          changeSpeed(1);
          break;
        case "<":
          changeSpeed(-1);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, seek, toggleFullscreen, setWindowFullscreen, changeSpeed, setPrefs]);

  const poke = () => {
    setShowControls(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!v()?.paused) setShowControls(false);
    }, 2500);
  };

  const cueIdx = cues ? activeCueIndex(cues, time) : -1;
  const caption = prefs.captionsEnabled && cueIdx >= 0 ? cues![cueIdx].text : null;
  const pct = duration ? (time / duration) * 100 : 0;

  return (
    <div
      ref={wrapRef}
      className={cn(
        "relative bg-black overflow-hidden select-none group",
        fullscreen ? "fixed inset-0 z-[100] w-screen h-screen" : "w-full aspect-video rounded-lg",
        !showControls && playing && "cursor-none"
      )}
      onMouseMove={poke}
      onMouseLeave={() => playing && setShowControls(false)}
    >
      <video
        ref={videoRef}
        src={src}
        className="w-full h-full object-contain"
        preload="metadata"
        playsInline
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          setDuration(el.duration);
          el.playbackRate = prefs.playbackRate;
          if (startAt > 1 && startAt < el.duration - 5) el.currentTime = startAt;
        }}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          setTime(el.currentTime);
          onTime?.(el.currentTime, el.duration);
        }}
        onPlay={() => {
          setPlaying(true);
          poke();
        }}
        onPause={() => {
          setPlaying(false);
          setShowControls(true);
        }}
        onWaiting={() => setBuffering(true)}
        onCanPlay={() => setBuffering(false)}
        onPlaying={() => setBuffering(false)}
        onEnded={() => {
          setPlaying(false);
          onEnded?.();
        }}
        onVolumeChange={(e) => {
          setMuted(e.currentTarget.muted);
          setVolume(e.currentTarget.volume);
        }}
        onError={() => setError("This video could not be played. The file may be incomplete or missing.")}
      />

      {/* Center overlays */}
      {error ? (
        <div className="absolute inset-0 flex items-center justify-center text-white/90 text-sm p-8 text-center">{error}</div>
      ) : buffering && playing ? (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Loader2 className="h-10 w-10 text-white/80 animate-spin" />
        </div>
      ) : !playing ? (
        <button
          onClick={togglePlay}
          className="absolute inset-0 m-auto h-16 w-16 rounded-full bg-[#0056D2]/90 hover:bg-[#0056D2] text-white flex items-center justify-center shadow-xl transition-transform hover:scale-105 cursor-pointer"
          aria-label="Play"
        >
          <Play className="h-7 w-7 fill-current ml-1" />
        </button>
      ) : null}

      {flash && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-md bg-black/70 text-white text-sm font-semibold pointer-events-none">
          {flash}
        </div>
      )}

      {/* Captions */}
      {caption && (
        <div
          className={cn(
            "absolute left-0 right-0 flex justify-center px-8 pointer-events-none transition-all",
            showControls ? "bottom-20" : "bottom-8"
          )}
        >
          <span
            className={cn(
              "bg-black/75 text-white rounded px-3 py-1 text-center leading-snug max-w-[80%]",
              fullscreen ? "text-2xl" : "text-base md:text-lg"
            )}
          >
            {caption}
          </span>
        </div>
      )}

      {/* Controls */}
      <div
        className={cn(
          "absolute bottom-0 left-0 right-0 pt-10 pb-2 px-3 bg-gradient-to-t from-black/85 via-black/40 to-transparent transition-opacity duration-200",
          showControls || !playing ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
      >
        {/* Seek bar */}
        <div className="relative h-4 flex items-center group/seek">
          <div className="absolute left-0 right-0 h-1 group-hover/seek:h-1.5 rounded-full bg-white/30 transition-all" />
          <div className="absolute left-0 h-1 group-hover/seek:h-1.5 rounded-full bg-[#2E7BFA] transition-all" style={{ width: `${pct}%` }} />
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={time}
            onChange={(e) => seek(Number(e.target.value))}
            className="video-seek absolute inset-0 w-full opacity-0 cursor-pointer"
            aria-label="Seek"
          />
        </div>

        <div className="flex items-center justify-between text-white mt-1">
          <div className="flex items-center gap-1">
            <CtrlButton onClick={togglePlay} label={playing ? "Pause (k)" : "Play (k)"}>
              {playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
            </CtrlButton>
            <CtrlButton onClick={() => seek(time - 10)} label="Back 10s (j)">
              <RotateCcw className="h-4.5 w-4.5" />
            </CtrlButton>
            <CtrlButton onClick={() => seek(time + 10)} label="Forward 10s (l)">
              <RotateCw className="h-4.5 w-4.5" />
            </CtrlButton>
            <div className="flex items-center group/vol">
              <CtrlButton
                onClick={() => {
                  const el = v();
                  if (el) el.muted = !el.muted;
                }}
                label="Mute (m)"
              >
                {muted || volume === 0 ? <VolumeX className="h-4.5 w-4.5" /> : <Volume2 className="h-4.5 w-4.5" />}
              </CtrlButton>
              <div className="w-0 overflow-hidden group-hover/vol:w-24 group-focus-within/vol:w-24 transition-[width] duration-200 flex items-center">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={(e) => {
                    const el = v();
                    if (!el) return;
                    el.volume = Number(e.target.value);
                    el.muted = el.volume === 0;
                  }}
                  className="w-20 mx-2 accent-white cursor-pointer"
                  aria-label="Volume"
                />
              </div>
            </div>
            <span className="text-xs tabular-nums ml-2 text-white/90">
              {formatClock(time)} / {formatClock(duration)}
            </span>
          </div>

          <div className="flex items-center gap-1 relative">
            <div className="relative">
              <button
                onClick={() => setSpeedOpen((o) => !o)}
                className="h-8 px-2 rounded text-xs font-semibold hover:bg-white/15 cursor-pointer tabular-nums"
                title="Playback speed (< >)"
              >
                {prefs.playbackRate}x
              </button>
              {speedOpen && (
                <div className="absolute bottom-10 right-0 bg-[#1F1F1F] rounded-md shadow-xl py-1 min-w-[90px] z-10">
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setPrefs({ playbackRate: s });
                        setSpeedOpen(false);
                      }}
                      className={cn(
                        "block w-full text-left px-3 py-1.5 text-xs hover:bg-white/10 cursor-pointer",
                        s === prefs.playbackRate && "text-[#93B8FF] font-semibold"
                      )}
                    >
                      {s === 1 ? "Normal" : `${s}x`}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {cues && cues.length > 0 && (
              <CtrlButton
                onClick={() => setPrefs({ captionsEnabled: !prefs.captionsEnabled })}
                label="Captions (c)"
                active={prefs.captionsEnabled}
              >
                <Captions className="h-5 w-5" />
              </CtrlButton>
            )}
            <CtrlButton onClick={toggleFullscreen} label="Fullscreen (f)">
              {fullscreen ? <Minimize className="h-4.5 w-4.5" /> : <Maximize className="h-4.5 w-4.5" />}
            </CtrlButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function CtrlButton({
  children,
  onClick,
  label,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "h-8 w-8 rounded flex items-center justify-center hover:bg-white/15 transition-colors cursor-pointer",
        active && "text-[#93B8FF]"
      )}
    >
      {children}
    </button>
  );
}
