import { useEffect, useRef, useState } from "react";
import { Headphones, Pause, Play, SkipBack, SkipForward, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { rankVoices, TtsReader, ttsSupported, type TtsState } from "@/lib/tts";
import { useAppStore } from "@/store/useAppStore";

interface ReadAloudProps {
  /** Element whose rendered text will be read. */
  targetRef: React.RefObject<HTMLElement | null>;
  /** Changes whenever the rendered content changes (re-collect sentences). */
  contentKey: string;
  className?: string;
}

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];

/** "Listen" bar: reads the target content aloud sentence by sentence with live highlighting. */
export function ReadAloud({ targetRef, contentKey, className }: ReadAloudProps) {
  const prefs = useAppStore((s) => s.playerPrefs);
  const setPrefs = useAppStore((s) => s.setPlayerPrefs);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<TtsState>("idle");
  const [pos, setPos] = useState({ index: 0, total: 0 });
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const readerRef = useRef<TtsReader | null>(null);

  // Voices load asynchronously in WebKit
  useEffect(() => {
    if (!ttsSupported()) return;
    const load = () => setVoices(rankVoices(window.speechSynthesis.getVoices()));
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  const voiceURI = prefs.ttsVoiceURI ?? voices[0]?.voiceURI ?? null;

  useEffect(() => {
    if (!ttsSupported()) return;
    readerRef.current = new TtsReader({
      voiceURI,
      rate: prefs.ttsRate,
      onState: setState,
      onIndex: (index, total) => setPos({ index, total }),
    });
    return () => readerRef.current?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    readerRef.current?.setOptions({ voiceURI, rate: prefs.ttsRate });
  }, [voiceURI, prefs.ttsRate]);

  // Re-collect sentences when content changes; stop reading the old content
  useEffect(() => {
    const el = targetRef.current;
    if (!el || !readerRef.current) return;
    const t = window.setTimeout(() => readerRef.current?.load(el), 50);
    return () => window.clearTimeout(t);
  }, [contentKey, targetRef]);

  // Click any paragraph to start reading from there while the bar is open
  useEffect(() => {
    const el = targetRef.current;
    if (!el || !open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("a, button, [data-asset-id]")) return;
      const block = target.closest("p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote");
      if (block && el.contains(block)) readerRef.current?.playFromElement(block);
    };
    el.addEventListener("click", onClick);
    el.classList.add("tts-clickable");
    return () => {
      el.removeEventListener("click", onClick);
      el.classList.remove("tts-clickable");
    };
  }, [open, targetRef, contentKey]);

  if (!ttsSupported()) return null;

  if (!open) {
    return (
      <button
        onClick={() => {
          setOpen(true);
          if (targetRef.current && readerRef.current && readerRef.current.total === 0) readerRef.current.load(targetRef.current);
          readerRef.current?.play();
        }}
        className={cn(
          "inline-flex items-center gap-2 h-9 px-3.5 rounded-full border border-primary/40 text-primary text-sm font-semibold hover:bg-primary/5 transition-colors cursor-pointer",
          className
        )}
      >
        <Headphones className="h-4 w-4" />
        Listen
      </button>
    );
  }

  const reader = readerRef.current;
  return (
    <div
      className={cn(
        "sticky top-3 z-20 flex flex-wrap items-center gap-2 rounded-full border border-border bg-card/95 backdrop-blur px-2 py-1.5 shadow-[0_6px_20px_rgba(0,0,0,0.08)]",
        className
      )}
    >
      <IconBtn label="Previous sentence" onClick={() => reader?.prev()}>
        <SkipBack className="h-4 w-4" />
      </IconBtn>
      <button
        onClick={() => reader?.toggle()}
        className="h-9 w-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 cursor-pointer"
        aria-label={state === "playing" ? "Pause" : "Play"}
      >
        {state === "playing" ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current ml-0.5" />}
      </button>
      <IconBtn label="Next sentence" onClick={() => reader?.next()}>
        <SkipForward className="h-4 w-4" />
      </IconBtn>
      <IconBtn label="Stop" onClick={() => reader?.stop()}>
        <Square className="h-3.5 w-3.5" />
      </IconBtn>

      <span className="text-xs text-muted-foreground tabular-nums px-1">
        {pos.total ? `${Math.min(pos.index + 1, pos.total)} / ${pos.total}` : "No text"}
      </span>

      <select
        value={prefs.ttsRate}
        onChange={(e) => setPrefs({ ttsRate: Number(e.target.value) })}
        className="h-8 rounded-full bg-secondary px-2 text-xs font-semibold text-foreground border-0 cursor-pointer"
        aria-label="Reading speed"
      >
        {RATES.map((r) => (
          <option key={r} value={r}>
            {r}x
          </option>
        ))}
      </select>

      {voices.length > 0 && (
        <select
          value={voiceURI ?? ""}
          onChange={(e) => setPrefs({ ttsVoiceURI: e.target.value })}
          className="h-8 max-w-[190px] rounded-full bg-secondary px-2 text-xs text-foreground border-0 cursor-pointer"
          aria-label="Voice"
        >
          {voices.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name} ({v.lang})
            </option>
          ))}
        </select>
      )}

      <IconBtn
        label="Close"
        onClick={() => {
          reader?.stop();
          setOpen(false);
        }}
      >
        <X className="h-4 w-4" />
      </IconBtn>
    </div>
  );
}

function IconBtn({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="h-8 w-8 rounded-full flex items-center justify-center text-foreground/80 hover:bg-secondary cursor-pointer"
    >
      {children}
    </button>
  );
}
