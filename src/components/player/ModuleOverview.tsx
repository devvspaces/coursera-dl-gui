import { useState } from "react";
import { BookOpen, ChevronDown, ChevronUp, ClipboardCheck, MonitorPlay, PlayCircle } from "lucide-react";
import {
  formatDuration,
  moduleStats,
  type CourseProgress,
  type FlatItem,
  type OutlineModule,
} from "@/lib/course";
import { ItemRow } from "@/components/player/parts";

interface ModuleOverviewProps {
  module: OutlineModule;
  moduleIndex: number;
  progress: CourseProgress;
  resume: FlatItem | null;
  preview?: boolean;
  onOpenItem: (id: string) => void;
}

export function ModuleOverview({ module, moduleIndex, progress, resume, preview, onOpenItem }: ModuleOverviewProps) {
  const stats = moduleStats(module, progress);
  const [showDesc, setShowDesc] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const statParts = [
    stats.videoMsLeft > 0 && { icon: MonitorPlay, label: `${formatDuration(stats.videoMsLeft)} of videos left` },
    stats.readingMsLeft > 0 && { icon: BookOpen, label: `${formatDuration(stats.readingMsLeft)} of readings left` },
    stats.gradedLeft > 0 && {
      icon: ClipboardCheck,
      label: `${stats.gradedLeft} graded assessment${stats.gradedLeft === 1 ? "" : "s"} left`,
    },
  ].filter(Boolean) as { icon: typeof BookOpen; label: string }[];

  return (
    <div className="space-y-6">
      {resume && (
        <div className="rounded-2xl bg-[#E8F0FE] dark:bg-[#1E223D] px-7 py-5 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm text-[#1F1F1F]/70 dark:text-white/60">Pick up where you left off</div>
            <div className="text-base font-semibold text-foreground truncate">{resume.item.name}</div>
            <div className="text-xs text-muted-foreground">
              Module {resume.moduleIndex + 1} • {resume.lesson.name}
            </div>
          </div>
          <button
            onClick={() => onOpenItem(resume.item.id)}
            className="shrink-0 inline-flex items-center gap-2 h-10 px-5 rounded-md bg-[#0056D2] hover:bg-[#00419e] text-white text-sm font-semibold cursor-pointer"
          >
            <PlayCircle className="h-4 w-4" /> Resume
          </button>
        </div>
      )}

      <section className="rounded-2xl bg-card border border-border/60 px-10 py-9">
        <div className="text-sm text-muted-foreground mb-1">Module {moduleIndex + 1}{module.optional ? " • Optional" : ""}</div>
        <h1 className="text-[26px] font-semibold text-foreground leading-tight">{module.name}</h1>

        {statParts.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 text-[15px] text-muted-foreground">
            {statParts.map((p, i) => (
              <span key={i} className="inline-flex items-center gap-1.5">
                {i > 0 && <span className="mr-1.5">•</span>}
                <p.icon className="h-4 w-4" /> {p.label}
              </span>
            ))}
          </div>
        ) : stats.total > 0 && stats.done === stats.total ? (
          <div className="mt-3 text-[15px] font-semibold text-[#1F8354]">All items in this module are complete</div>
        ) : null}

        {module.description && (
          <div className="mt-5">
            {showDesc && <p className="text-[17px] leading-8 text-foreground/90 whitespace-pre-line">{module.description}</p>}
            <button
              onClick={() => setShowDesc((s) => !s)}
              className="mt-3 inline-flex items-center gap-1 text-[15px] font-semibold text-foreground hover:text-primary cursor-pointer"
            >
              {showDesc ? "Hide description" : "Show description"}
              {showDesc ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
        )}

        <div className="mt-8 space-y-6">
          {module.lessons.map((lesson) => {
            const isCollapsed = collapsed[lesson.id];
            return (
              <div key={lesson.id}>
                <button
                  onClick={() => setCollapsed((c) => ({ ...c, [lesson.id]: !c[lesson.id] }))}
                  className="w-full flex items-center justify-between py-2 text-left cursor-pointer group"
                >
                  <h2 className="text-lg font-semibold text-foreground group-hover:text-primary">{lesson.name}</h2>
                  {isCollapsed ? <ChevronDown className="h-5 w-5" /> : <ChevronUp className="h-5 w-5" />}
                </button>
                {!isCollapsed && (
                  <div className="mt-1 space-y-0.5">
                    {lesson.items.map((item) => (
                      <ItemRow
                        key={item.id}
                        item={item}
                        done={Boolean(progress.completed[item.id])}
                        preview={preview}
                        onClick={() => onOpenItem(item.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
