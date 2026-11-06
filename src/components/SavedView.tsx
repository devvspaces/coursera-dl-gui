import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Award, Bookmark as BookmarkIcon, BookOpen, Download, Layers, Loader2, MonitorPlay, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CachedImage } from "@/components/CachedImage";
import {
  useAppStore,
  type Bookmark,
  type CourseManifest,
  type SpecializationDetails,
} from "@/store/useAppStore";

export function SavedView() {
  const bookmarks = useAppStore((s) => s.bookmarks);
  const removeBookmark = useAppStore((s) => s.removeBookmark);
  const openCoursePreview = useAppStore((s) => s.openCoursePreview);
  const setBrowsingSpec = useAppStore((s) => s.setBrowsingSpec);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const setActiveManifest = useAppStore((s) => s.setActiveManifest);
  const maxResolution = useAppStore((s) => s.maxResolution);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "course" | "spec">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const list = bookmarks.filter(
    (b) =>
      (filter === "all" || b.kind === filter) &&
      (!q || b.name.toLowerCase().includes(q) || b.slug.includes(q) || (b.partner_name || "").toLowerCase().includes(q))
  );

  const key = (b: Bookmark) => `${b.kind}:${b.slug}`;

  const openSpec = async (b: Bookmark) => {
    setBusy(key(b));
    setError(null);
    try {
      const details = await invoke<SpecializationDetails>("get_specialization_details", { slug: b.slug });
      setBrowsingSpec({ details, label: b.label });
      setActiveView("custom_download");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const downloadCourse = async (b: Bookmark) => {
    setBusy(key(b));
    setError(null);
    try {
      const manifest = await invoke<CourseManifest>("prepare_course_download", {
        slug: b.slug,
        isSpec: false,
        prefixSep: " - ",
        maxResolution,
      });
      setActiveManifest(manifest);
      setActiveView("downloads");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 border-b border-border/60 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <BookmarkIcon className="h-6 w-6 text-primary" />
            Saved for Later
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Courses, specializations and professional certificates you bookmarked to preview or download later.
          </p>
        </div>
        <div className="flex items-center gap-1 bg-secondary/60 p-1 rounded-md">
          {(["all", "course", "spec"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 h-7 rounded text-xs font-semibold cursor-pointer ${
                filter === f ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f === "all" ? "All" : f === "course" ? "Courses" : "Programs"}
            </button>
          ))}
        </div>
      </div>

      {bookmarks.length > 0 && (
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter saved items..."
            className="pl-9 h-11 bg-card"
          />
        </div>
      )}

      {error && (
        <div className="rounded-md bg-destructive/10 text-destructive text-sm px-4 py-3">{error}</div>
      )}

      {bookmarks.length === 0 ? (
        <Card className="p-16 text-center max-w-xl mx-auto border-border/60 bg-card/40">
          <BookmarkIcon className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-40" />
          <h3 className="text-lg font-semibold text-foreground mb-1">Nothing saved yet</h3>
          <p className="text-sm text-muted-foreground mb-6">
            Paste a course, specialization or professional certificate link under <b>Browse by Link</b>, then use
            <b> Save</b> on anything you want to come back to.
          </p>
          <Button onClick={() => setActiveView("custom_download")} className="gap-2 cursor-pointer">
            Browse by link
          </Button>
        </Card>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">No saved items match.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {list.map((b) => {
            const isSpec = b.kind === "spec";
            const Icon = b.label === "Professional Certificate" ? Award : isSpec ? Layers : BookOpen;
            const loading = busy === key(b);
            return (
              <Card
                key={key(b)}
                className="overflow-hidden flex flex-col border border-[#D9D9D9] dark:border-white/10 bg-white dark:bg-[#12131F] rounded-[8px] shadow-[0_2px_4px_rgba(0,0,0,0.06)] hover:shadow-[0_12px_24px_rgba(0,0,0,0.12)] transition-shadow"
              >
                <div className="relative h-36 bg-[#1F1F1F]">
                  <CachedImage
                    src={b.photo_url}
                    alt={b.name}
                    fallbackIcon={isSpec ? "spec" : "course"}
                    className="w-full h-full object-cover"
                  />
                  <Badge className="absolute top-3 left-3 bg-black/70 text-white border-0 text-[10px] gap-1 rounded-[4px]">
                    <Icon className="h-3 w-3" />
                    {b.label}
                    {b.course_count ? ` · ${b.course_count} courses` : ""}
                  </Badge>
                </div>
                <div className="p-4 flex-1 flex flex-col">
                  {b.partner_name && (
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{b.partner_name}</div>
                  )}
                  <h3 className="text-[15px] font-bold leading-snug text-foreground line-clamp-2 mt-0.5">{b.name}</h3>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    Saved {new Date(b.savedAt).toLocaleDateString()}
                  </div>
                  <div className="mt-auto pt-4 flex items-center gap-1.5">
                    <Button
                      size="sm"
                      disabled={loading}
                      onClick={() => (isSpec ? openSpec(b) : openCoursePreview(b.slug, b.name))}
                      className="h-8 px-3 gap-1.5 text-xs font-semibold rounded-[4px] bg-[#0056D2] hover:bg-[#00419e] text-white cursor-pointer"
                    >
                      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isSpec ? <Layers className="h-3.5 w-3.5" /> : <MonitorPlay className="h-3.5 w-3.5" />}
                      {isSpec ? "View courses" : "Preview"}
                    </Button>
                    {!isSpec && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={loading}
                        onClick={() => downloadCourse(b)}
                        className="h-8 px-3 gap-1.5 text-xs font-semibold rounded-[4px] cursor-pointer"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeBookmark(b.kind, b.slug)}
                      className="h-8 w-8 p-0 ml-auto text-muted-foreground hover:text-destructive cursor-pointer"
                      title="Remove from saved"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
