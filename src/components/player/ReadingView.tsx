import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, FileText, Loader2, X } from "lucide-react";
import { cmlToHtml, isCml, sanitizeHtml } from "@/lib/cml";
import { courseFileUrl, isLocal, joinPath, type CourseOutline, type OutlineItem } from "@/lib/course";
import { ReadAloud } from "@/components/player/ReadAloud";

interface ReadingViewProps {
  outline: CourseOutline;
  item: OutlineItem;
}

interface RemoteAsset {
  id: string;
  url: string;
  ext: string;
  name: string;
}

/** A resolved attachment: where to load it, and (for local files) its path on disk. */
interface AssetRef {
  url: string;
  file: string;
  path?: string;
}

export function ReadingView({ outline, item }: ReadingViewProps) {
  const local = isLocal(item) && Boolean(item.reading);
  const [raw, setRaw] = useState<string | null>(null);
  const [remoteAssets, setRemoteAssets] = useState<Record<string, RemoteAsset>>({});
  const [error, setError] = useState<string | null>(null);
  const [pdf, setPdf] = useState<{ url: string; name: string; path?: string } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setRaw(null);
    setError(null);
    setPdf(null);
    setRemoteAssets({});
    if (local) {
      invoke<string>("read_course_file", { path: joinPath(outline.course_dir, item.reading!) })
        .then((text) => !cancelled && setRaw(text))
        .catch((e) => !cancelled && setError(String(e)));
    } else {
      invoke<{ cml: string; assets: RemoteAsset[] }>("get_remote_reading", {
        courseId: outline.course_id,
        itemId: item.id,
      })
        .then((r) => {
          if (cancelled) return;
          setRemoteAssets(Object.fromEntries(r.assets.map((a) => [a.id, a])));
          setRaw(r.cml);
        })
        .catch((e) => !cancelled && setError(String(e)));
    }
    return () => {
      cancelled = true;
    };
  }, [outline.course_dir, outline.course_id, item.id, item.reading, local]);

  const resolveAsset = (id: string): AssetRef | null => {
    const file = outline.assets[id];
    if (file && outline.course_dir) {
      return { url: courseFileUrl(outline, `_assets/${file}`), file, path: joinPath(outline.course_dir, `_assets/${file}`) };
    }
    const remote = remoteAssets[id];
    return remote ? { url: remote.url, file: `${remote.name}.${remote.ext}` } : null;
  };

  const html = useMemo(() => {
    if (raw === null) return "";
    const ctx = { assetUrl: (id: string) => resolveAsset(id)?.url ?? null };
    return isCml(raw) ? cmlToHtml(raw, ctx) : sanitizeHtml(raw, ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, outline, remoteAssets]);

  const onClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const link = target.closest<HTMLAnchorElement>("a[data-external]");
    if (link) {
      e.preventDefault();
      openUrl(link.href).catch(console.error);
      return;
    }
    const asset = target.closest<HTMLElement>("[data-asset-id]");
    if (asset) {
      const ref = resolveAsset(asset.dataset.assetId!);
      if (!ref) return;
      const name = asset.querySelector(".cml-asset-name")?.textContent || ref.file;
      const isPdf = (asset.dataset.ext || ref.file).toLowerCase().endsWith("pdf");
      if (isPdf) {
        setPdf({ url: ref.url, name, path: ref.path });
      } else if (ref.path) {
        invoke("open_course_file", { path: ref.path }).catch(console.error);
      } else {
        openUrl(ref.url).catch(console.error);
      }
    }
  };

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
        Could not open this reading: {error}
      </div>
    );
  }
  if (raw === null) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-10">
        <Loader2 className="h-4 w-4 animate-spin" /> {local ? "Loading reading…" : "Loading reading from Coursera…"}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ReadAloud targetRef={contentRef} contentKey={item.id + html.length} />

      <div ref={contentRef} className="cml-reading" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />

      {pdf && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" onClick={() => setPdf(null)}>
          <div className="bg-card rounded-xl w-full max-w-5xl h-full flex flex-col overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 h-12 border-b border-border">
              <div className="flex items-center gap-2 min-w-0 text-sm font-semibold">
                <FileText className="h-4 w-4 text-primary shrink-0" />
                <span className="truncate">{pdf.name}</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() =>
                    (pdf.path ? invoke("open_course_file", { path: pdf.path }) : openUrl(pdf.url)).catch(console.error)
                  }
                  className="h-8 px-3 rounded-md text-xs font-semibold text-primary hover:bg-primary/5 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> {pdf.path ? "Open in Preview" : "Open in browser"}
                </button>
                <button onClick={() => setPdf(null)} className="h-8 w-8 rounded-md hover:bg-secondary flex items-center justify-center cursor-pointer" aria-label="Close">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <iframe src={pdf.url} title={pdf.name} className="flex-1 w-full bg-white" />
          </div>
        </div>
      )}
    </div>
  );
}
