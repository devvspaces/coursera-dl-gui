import { convertFileSrc } from "@tauri-apps/api/core";

export interface SubtitleTrack {
  lang: string;
  path: string;
}

export interface OutlineItem {
  id: string;
  name: string;
  slug: string;
  item_type: string;
  duration_ms: number;
  locked: boolean;
  video?: string | null;
  subtitles: SubtitleTrack[];
  reading?: string | null;
  url: string;
  available: boolean;
}

export interface OutlineLesson {
  id: string;
  name: string;
  slug: string;
  duration_ms: number;
  folder: string;
  items: OutlineItem[];
}

export interface OutlineModule {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  duration_ms: number;
  optional: boolean;
  folder: string;
  lessons: OutlineLesson[];
}

export interface CourseOutline {
  version: number;
  slug: string;
  course_id: string;
  name: string;
  description?: string | null;
  workload?: string | null;
  photo_url?: string | null;
  partner_name?: string | null;
  partner_logo?: string | null;
  modules: OutlineModule[];
  inferred: boolean;
  /** Fetched live from Coursera; items without local files stream online. */
  preview: boolean;
  course_dir: string;
  assets: Record<string, string>;
}

export interface CourseProgress {
  completed: Record<string, boolean>;
  positions: Record<string, number>;
  lastItemId?: string;
}

/** An item together with where it sits in the course. */
export interface FlatItem {
  item: OutlineItem;
  moduleIndex: number;
  lessonIndex: number;
  module: OutlineModule;
  lesson: OutlineLesson;
}

export function flattenItems(outline: CourseOutline): FlatItem[] {
  const out: FlatItem[] = [];
  outline.modules.forEach((module, moduleIndex) =>
    module.lessons.forEach((lesson, lessonIndex) =>
      lesson.items.forEach((item) => out.push({ item, moduleIndex, lessonIndex, module, lesson }))
    )
  );
  return out;
}

export function joinPath(dir: string, rel: string): string {
  return `${dir.replace(/\/+$/, "")}/${rel.replace(/^\/+/, "")}`;
}

/** URL the webview can load for a file inside the course directory (video, image, PDF). */
export function courseFileUrl(outline: CourseOutline, rel: string): string {
  return convertFileSrc(joinPath(outline.course_dir, rel));
}

export type ItemKind = "video" | "reading" | "graded" | "practice" | "discussion" | "other";

export function itemKind(type: string): ItemKind {
  switch (type) {
    case "lecture":
      return "video";
    case "supplement":
      return "reading";
    case "staffGraded":
    case "gradedProgramming":
    case "exam":
    case "gradedPeer":
    case "gradedLti":
    case "gradedDiscussionPrompt":
    case "phasedPeer":
    case "splitPeerReviewItem":
      return "graded";
    case "quiz":
    case "ungradedProgramming":
    case "ungradedLti":
    case "ungradedWidget":
    case "practiceQuiz":
      return "practice";
    case "discussionPrompt":
      return "discussion";
    default:
      return "other";
  }
}

export function itemKindLabel(type: string): string {
  switch (type) {
    case "lecture":
      return "Video";
    case "supplement":
      return "Reading";
    case "staffGraded":
    case "exam":
      return "Graded Assignment";
    case "gradedProgramming":
      return "Programming Assignment";
    case "quiz":
    case "practiceQuiz":
      return "Practice Assignment";
    case "ungradedProgramming":
      return "Practice Programming";
    case "discussionPrompt":
    case "gradedDiscussionPrompt":
      return "Discussion Prompt";
    case "gradedPeer":
    case "phasedPeer":
      return "Peer-graded Assignment";
    case "ungradedLti":
    case "gradedLti":
    case "ungradedWidget":
      return "App Item";
    default:
      return type ? type.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()) : "Item";
  }
}

/** "7 min", "1h 5m" — Coursera style. */
export function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return "";
  const totalMin = Math.max(1, Math.round(ms / 60000));
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Media clock: 1:05, 1:02:09 */
export function formatClock(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function moduleStats(module: OutlineModule, progress: CourseProgress) {
  let videoMsLeft = 0;
  let readingMsLeft = 0;
  let gradedLeft = 0;
  let total = 0;
  let done = 0;
  for (const lesson of module.lessons) {
    for (const item of lesson.items) {
      const isDone = Boolean(progress.completed[item.id]);
      const kind = itemKind(item.item_type);
      total += 1;
      if (isDone) {
        done += 1;
        continue;
      }
      if (kind === "video") videoMsLeft += item.duration_ms;
      else if (kind === "reading") readingMsLeft += item.duration_ms;
      else if (kind === "graded") gradedLeft += 1;
    }
  }
  return { videoMsLeft, readingMsLeft, gradedLeft, total, done };
}

/** Item has a local file to play/read. */
export function isLocal(item: OutlineItem): boolean {
  return item.available && Boolean(item.video || item.reading);
}

/** Item can be streamed from Coursera in preview mode. */
export function isStreamable(outline: CourseOutline, item: OutlineItem): boolean {
  return outline.preview && !item.locked && (item.item_type === "lecture" || item.item_type === "supplement");
}

export function emptyProgress(): CourseProgress {
  return { completed: {}, positions: {} };
}
