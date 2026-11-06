import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Download, Layers, Sparkles, Loader2, MonitorPlay, Link2, BookOpen, Award } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAppStore, type CourseManifest, type SpecializationDetails } from "@/store/useAppStore";
import { SpecializationEnrollmentView } from "@/components/SpecializationEnrollmentView";
import { parseCourseraInput } from "@/lib/coursera-url";

export function CustomDownloadView() {
  const [input, setInput] = useState("");
  const [isSpecManual, setIsSpecManual] = useState(false);
  const [prefixSep, setPrefixSep] = useState(" - ");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const browsingSpec = useAppStore((s) => s.browsingSpec);
  const setBrowsingSpec = useAppStore((s) => s.setBrowsingSpec);
  const setActiveManifest = useAppStore((s) => s.setActiveManifest);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const openCoursePreview = useAppStore((s) => s.openCoursePreview);
  const maxResolution = useAppStore((s) => s.maxResolution);

  const parsed = useMemo(() => parseCourseraInput(input), [input]);
  const isSpec = parsed.kind ? parsed.kind === "spec" : isSpecManual;
  const specLabel = parsed.label === "Professional Certificate" ? "Professional Certificate" : "Specialization";

  const handleRefreshSpec = async () => {
    if (!browsingSpec) return;
    try {
      const details = await invoke<SpecializationDetails>("get_specialization_details", {
        slug: browsingSpec.details.slug,
      });
      setBrowsingSpec({ ...browsingSpec, details });
    } catch (err: any) {
      setErrorMsg(typeof err === "string" ? err : err?.message || "Failed to recheck details");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!parsed.slug) return;

    setIsLoading(true);
    setErrorMsg(null);

    try {
      if (isSpec) {
        const details = await invoke<SpecializationDetails>("get_specialization_details", { slug: parsed.slug });
        setBrowsingSpec({ details, label: specLabel });
      } else {
        const manifest = await invoke<CourseManifest>("prepare_course_download", {
          slug: parsed.slug,
          isSpec: false,
          prefixSep,
          maxResolution,
        });
        setActiveManifest(manifest);
        setActiveView("downloads");
      }
    } catch (err: any) {
      setErrorMsg(typeof err === "string" ? err : err?.message || "Failed to prepare download");
    } finally {
      setIsLoading(false);
    }
  };

  if (browsingSpec) {
    return (
      <SpecializationEnrollmentView
        specDetails={browsingSpec.details}
        label={browsingSpec.label}
        prefixSep={prefixSep}
        onBack={() => setBrowsingSpec(null)}
        onRefresh={handleRefreshSpec}
      />
    );
  }

  const DetectedIcon = parsed.label === "Professional Certificate" ? Award : parsed.kind === "spec" ? Layers : BookOpen;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
          <Download className="h-6 w-6 text-primary" />
          Download by Link or Slug
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Paste any Coursera course, specialization or professional certificate link to browse, preview and download it.
        </p>
      </div>

      <Card className="border border-[#D9D9D9] dark:border-white/10 bg-white dark:bg-[#12131F] rounded-[8px] shadow-[0_2px_4px_rgba(0,0,0,0.06)]">
        <CardHeader className="p-6 pb-4">
          <CardTitle className="text-lg font-bold text-[#1F1F1F] dark:text-white">Coursera link</CardTitle>
          <CardDescription className="text-xs text-[#5F5F5F] dark:text-[#98A2B3] leading-relaxed">
            e.g. coursera.org/learn/<span className="text-[#0056D2] dark:text-[#2E7BFA] font-mono font-medium">linux-and-sql</span>,
            /specializations/<span className="text-[#0056D2] dark:text-[#2E7BFA] font-mono font-medium">deep-learning</span> or
            /professional-certificates/<span className="text-[#0056D2] dark:text-[#2E7BFA] font-mono font-medium">google-cybersecurity</span>
            — or just the slug.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-6 pt-0">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-[#5F5F5F] dark:text-[#98A2B3]">
                URL or slug
              </label>
              <div className="relative">
                <Link2 className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="https://www.coursera.org/professional-certificates/google-cybersecurity"
                  required
                  className="pl-9 font-mono text-sm bg-white dark:bg-[#0B0B14] border-[#D9D9D9] dark:border-white/15 rounded-[6px]"
                />
              </div>
              {parsed.kind && (
                <div className="flex items-center gap-1.5 text-xs font-medium text-[#0056D2] dark:text-[#93B8FF] pt-1">
                  <DetectedIcon className="h-3.5 w-3.5" />
                  {parsed.label} detected · <span className="font-mono">{parsed.slug}</span>
                </div>
              )}
            </div>

            {!parsed.kind && (
              <div className="flex items-center gap-6 pt-1">
                <label className="flex items-center gap-2.5 cursor-pointer text-sm text-[#1F1F1F] dark:text-white select-none">
                  <input
                    type="checkbox"
                    checked={isSpecManual}
                    onChange={(e) => setIsSpecManual(e.target.checked)}
                    className="rounded border-[#D9D9D9] text-[#0056D2] focus:ring-[#0056D2] h-4 w-4"
                  />
                  <span className="flex items-center gap-1.5 font-medium">
                    <Layers className="h-4 w-4 text-[#5F5F5F] dark:text-[#98A2B3]" />
                    Slug is a specialization or professional certificate
                  </span>
                </label>
              </div>
            )}

            <div className="space-y-1.5 pt-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-[#5F5F5F] dark:text-[#98A2B3]">
                Numbering Index Separator
              </label>
              <div className="flex items-center gap-3">
                <Input
                  value={prefixSep}
                  onChange={(e) => setPrefixSep(e.target.value)}
                  placeholder="e.g. ' - ' or '_' or '. '"
                  className="w-32 font-mono text-sm bg-white dark:bg-[#0B0B14] border-[#D9D9D9] dark:border-white/15 rounded-[6px] text-center"
                />
                <span className="text-xs text-[#5F5F5F] dark:text-[#98A2B3]">
                  Preview: <span className="font-mono font-semibold text-[#1F1F1F] dark:text-white">01{prefixSep}Module_Title</span>
                </span>
              </div>
            </div>

            {errorMsg && (
              <div className="rounded-[6px] bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 p-3 text-xs text-red-600 dark:text-red-400 font-medium">
                {errorMsg}
              </div>
            )}

            <div className="flex gap-2 mt-2">
              {!isSpec && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={isLoading || !parsed.slug}
                  onClick={() => openCoursePreview(parsed.slug)}
                  className="gap-2 font-semibold text-sm rounded-[4px] h-10 border-[#0056D2]/40 text-[#0056D2] dark:text-[#93B8FF] hover:bg-[#E8F0FE] dark:hover:bg-[#1E223D] cursor-pointer"
                >
                  <MonitorPlay className="h-4 w-4" />
                  Preview first
                </Button>
              )}
              <Button
                type="submit"
                disabled={isLoading || !parsed.slug}
                className="flex-1 gap-2 font-semibold text-sm rounded-[4px] bg-[#0056D2] hover:bg-[#00419e] text-white shadow-xs cursor-pointer h-10"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {isSpec ? `Loading ${specLabel}...` : "Generating Manifest & File Tree..."}
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    {isSpec ? `Browse ${specLabel} Courses` : "Analyze & Prepare Download"}
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
