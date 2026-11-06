import {
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Lock,
  MessagesSquare,
  MonitorPlay,
  Puzzle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration, itemKind, itemKindLabel, type OutlineItem } from "@/lib/course";

export function ItemIcon({ item, done, className }: { item: OutlineItem; done?: boolean; className?: string }) {
  if (done) return <CheckCircle2 className={cn("h-5 w-5 text-white fill-[#1F8354] shrink-0", className)} />;
  const cls = cn("h-5 w-5 text-foreground/70 shrink-0", className);
  switch (itemKind(item.item_type)) {
    case "video":
      return <MonitorPlay className={cls} />;
    case "reading":
      return <BookOpen className={cls} />;
    case "graded":
      return <ClipboardCheck className={cls} />;
    case "practice":
      return <ClipboardList className={cls} />;
    case "discussion":
      return <MessagesSquare className={cls} />;
    default:
      return <Puzzle className={cls} />;
  }
}

export function itemMeta(item: OutlineItem): string {
  const parts = [itemKindLabel(item.item_type)];
  const d = formatDuration(item.duration_ms);
  if (d) parts.push(d);
  return parts.join(" • ");
}

interface ItemRowProps {
  item: OutlineItem;
  done: boolean;
  active?: boolean;
  compact?: boolean;
  /** Course is being previewed online: label items as downloaded vs streaming. */
  preview?: boolean;
  onClick: () => void;
}

/** One row in a lesson list (module overview and item-page sidebar). */
export function ItemRow({ item, done, active, compact, preview, onClick }: ItemRowProps) {
  const offline = item.available;
  const online = !item.video && !item.reading;
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-start gap-3 text-left rounded-md transition-colors cursor-pointer",
        compact ? "px-3 py-2.5" : "px-2 py-3",
        active ? "bg-[#F0F6FF] dark:bg-[#1E223D] shadow-[inset_3px_0_0_#0056D2]" : "hover:bg-secondary/60"
      )}
    >
      <ItemIcon item={item} done={done} className={compact ? "h-4.5 w-4.5 mt-0.5" : "mt-0.5"} />
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "text-foreground leading-snug",
            compact ? "text-sm" : "text-base",
            active && "font-semibold"
          )}
        >
          {item.name}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
          <span>{itemMeta(item)}</span>
          {online && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/80">
              • <Lock className="h-3 w-3" /> On Coursera
            </span>
          )}
          {!online && item.locked && !offline && (
            <span className="inline-flex items-center gap-1 text-[11px]">
              • <Lock className="h-3 w-3" /> Locked
            </span>
          )}
          {!online && !item.locked && !offline &&
            (preview ? (
              <span className="text-[#0056D2] dark:text-[#93B8FF]">• Streams online</span>
            ) : (
              <span className="text-amber-600 dark:text-amber-400">• Not downloaded</span>
            ))}
          {preview && offline && <span className="text-[#1F8354]">• Downloaded</span>}
        </div>
      </div>
    </button>
  );
}

/** Small completion ring used for modules in the sidebar. */
export function ProgressRing({ value, size = 18 }: { value: number; size?: number }) {
  const r = (size - 3) / 2;
  const c = 2 * Math.PI * r;
  if (value >= 1) return <CheckCircle2 className="text-white fill-[#1F8354] shrink-0" style={{ width: size + 2, height: size + 2 }} />;
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-foreground/50" />
      {value > 0 && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#1F8354"
          strokeWidth={2.5}
          strokeDasharray={`${c * value} ${c}`}
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
