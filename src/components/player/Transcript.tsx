import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { formatClock } from "@/lib/course";
import { activeCueIndex, groupIntoParagraphs, type Cue } from "@/lib/subtitles";

interface TranscriptProps {
  cues: Cue[];
  currentTime: number;
  onSeek: (t: number) => void;
  autoScroll: boolean;
  query?: string;
}

/** Coursera-style interactive transcript: cues are clickable and the spoken one is highlighted. */
export function Transcript({ cues, currentTime, onSeek, autoScroll, query }: TranscriptProps) {
  const paragraphs = useMemo(() => groupIntoParagraphs(cues), [cues]);
  const active = activeCueIndex(cues, currentTime);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastScrolled = useRef(-1);
  const q = query?.trim().toLowerCase();

  useEffect(() => {
    if (!autoScroll || active < 0 || active === lastScrolled.current) return;
    lastScrolled.current = active;
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-cue="${active}"]`);
    const box = containerRef.current;
    if (el && box) {
      const top = el.offsetTop - box.offsetTop;
      if (top < box.scrollTop + 40 || top > box.scrollTop + box.clientHeight - 80) {
        box.scrollTo({ top: Math.max(0, top - box.clientHeight / 3), behavior: "smooth" });
      }
    }
  }, [active, autoScroll]);

  return (
    <div ref={containerRef} className="relative max-h-[420px] overflow-y-auto custom-scrollbar pr-2 space-y-4 text-[15px] leading-7">
      {paragraphs.map((idxs, pi) => (
        <div key={pi} className="flex gap-3">
          <button
            onClick={() => onSeek(cues[idxs[0]].start)}
            className="shrink-0 w-12 pt-0.5 text-left text-xs font-semibold text-primary hover:underline tabular-nums cursor-pointer"
          >
            {formatClock(cues[idxs[0]].start)}
          </button>
          <p className="text-foreground/85">
          {idxs.map((i) => {
            const match = q && cues[i].text.toLowerCase().includes(q);
            return (
              <span
                key={i}
                data-cue={i}
                onClick={() => onSeek(cues[i].start)}
                className={cn(
                  "cursor-pointer rounded-sm transition-colors hover:bg-primary/10 px-0.5 -mx-0.5",
                  i === active && "bg-[#0056D2]/15 text-foreground dark:bg-[#2E7BFA]/30",
                  match && "underline decoration-amber-500 decoration-2 underline-offset-4"
                )}
              >
                {cues[i].text}{" "}
              </span>
            );
          })}
          </p>
        </div>
      ))}
    </div>
  );
}
