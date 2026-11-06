import { BookmarkCheck, BookmarkPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore, type Bookmark } from "@/store/useAppStore";

interface BookmarkButtonProps {
  bookmark: Omit<Bookmark, "savedAt">;
  /** "icon" for compact rows/cards, "full" shows a label. */
  variant?: "icon" | "full";
  className?: string;
}

export function BookmarkButton({ bookmark, variant = "full", className }: BookmarkButtonProps) {
  const saved = useAppStore((s) => s.bookmarks.some((b) => b.kind === bookmark.kind && b.slug === bookmark.slug));
  const toggleBookmark = useAppStore((s) => s.toggleBookmark);
  const Icon = saved ? BookmarkCheck : BookmarkPlus;
  const title = saved ? "Saved — click to remove" : "Save for later";

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        toggleBookmark(bookmark);
      }}
      title={title}
      aria-label={title}
      aria-pressed={saved}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-[4px] text-xs font-semibold transition-colors cursor-pointer border",
        variant === "icon" ? "h-8 w-8" : "h-8 px-3",
        saved
          ? "border-[#0056D2]/40 bg-[#E8F0FE] text-[#0056D2] dark:bg-[#1E223D] dark:text-[#93B8FF] dark:border-[#2E7BFA]/40"
          : "border-[#D9D9D9] dark:border-white/15 text-[#1F1F1F] dark:text-white hover:bg-[#F5F7FA] dark:hover:bg-white/5",
        className
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {variant === "full" && (saved ? "Saved" : "Save")}
    </button>
  );
}
