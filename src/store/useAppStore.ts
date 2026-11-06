import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface UserProfile {
  user_id: string;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  is_authenticated: boolean;
}

export interface EnrolledCourse {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  photo_url?: string | null;
  partner_name?: string | null;
  partner_logo?: string | null;
  progress?: number | null;
}

export interface DownloadTask {
  id: string;
  title: string;
  url: string;
  relative_path: string;
  total_bytes: number;
  downloaded_bytes: number;
  status: "pending" | "downloading" | "completed" | "failed" | "cancelled";
  error?: string | null;
}

export interface CourseManifest {
  course_name: string;
  slug: string;
  is_spec: boolean;
  photo_url?: string | null;
  tasks: DownloadTask[];
  total_files: number;
  total_size_est: number;
}

export interface SpecCourseInfo {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  photo_url?: string | null;
  is_enrolled: boolean;
  order: number;
}

export interface SpecializationDetails {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  photo_url?: string | null;
  logo?: string | null;
  partner_name?: string | null;
  courses: SpecCourseInfo[];
  total_courses: number;
  enrolled_courses: number;
  all_enrolled: boolean;
}

export interface DownloadProgressEvent {
  task_id: string;
  status: "pending" | "downloading" | "completed" | "failed" | "cancelled";
  downloaded_bytes: number;
  total_bytes: number;
  progress_percent: number;
  current_file: string;
  overall_completed: number;
  overall_total: number;
  error?: string | null;
}

export interface CourseDownloadInfo {
  slug: string;
  course_name: string;
  path: string;
  photo_url?: string | null;
  total_files: number;
  downloaded_files: number;
  total_bytes: number;
  downloaded_bytes: number;
  percent: number;
  status: "not_downloaded" | "downloading" | "partially_downloaded" | "completed";
  is_completed: boolean;
  last_updated: number;
}

export interface DownloadedItem {
  id: string;
  title: string;
  slug: string;
  path: string;
  photo_url?: string | null;
  is_spec: boolean;
  total_files: number;
  downloaded_files: number;
  downloaded_bytes: number;
  percent: number;
  status: "completed" | "partially_downloaded";
  sub_courses: string[];
  last_modified: number;
}

export type VideoResolution = 360 | 540 | 720 | 1080;

export type AppView = "courses" | "custom_download" | "downloads" | "saved" | "settings" | "player";

export interface PlayerCourseRef {
  /** "local": open a downloaded folder. "preview": fetch live from Coursera (local files used when present). */
  mode?: "local" | "preview";
  /** Absolute path of the course folder (local mode). */
  path?: string;
  /** Coursera slug (required for preview; used to rebuild metadata locally). */
  slug?: string;
  title?: string;
}

export interface Bookmark {
  kind: "course" | "spec";
  /** Display label, e.g. "Course", "Specialization", "Professional Certificate". */
  label: string;
  slug: string;
  name: string;
  photo_url?: string | null;
  partner_name?: string | null;
  course_count?: number;
  savedAt: number;
}

export interface BrowsingSpec {
  details: SpecializationDetails;
  label: string;
}

export interface PlayerPrefs {
  playbackRate: number;
  captionsEnabled: boolean;
  autoplayNext: boolean;
  transcriptAutoScroll: boolean;
  ttsVoiceURI: string | null;
  ttsRate: number;
}

interface AppState {
  user: UserProfile | null;
  enrolledCourses: EnrolledCourse[];
  activeManifest: CourseManifest | null;
  outputDirectory: string;
  maxResolution: VideoResolution;
  maxConcurrentDownloads: number;
  enableDownloadDelay: boolean;
  minDelaySeconds: number;
  maxDelaySeconds: number;
  delayVideosOnly: boolean;
  isDownloading: boolean;
  activeView: AppView;
  playerCourse: PlayerCourseRef | null;
  playerReturnView: AppView;
  playerPrefs: PlayerPrefs;
  bookmarks: Bookmark[];
  browsingSpec: BrowsingSpec | null;
  currentProgress: DownloadProgressEvent | null;
  liveTasks: Record<string, DownloadTask>;

  coursesCache: Record<string, EnrolledCourse[]>;
  lastCoursesFetchedAt: Record<string, number>;
  downloadStatusMap: Record<string, CourseDownloadInfo>;
  setUser: (user: UserProfile | null) => void;
  setEnrolledCourses: (courses: EnrolledCourse[]) => void;
  setCachedCoursesForUser: (userId: string, courses: EnrolledCourse[]) => void;
  setLastCoursesFetchedAt: (userId: string, timestamp: number) => void;
  setDownloadStatusMap: (map: Record<string, CourseDownloadInfo>) => void;
  updateCourseDownloadStatus: (slug: string, info: Partial<CourseDownloadInfo>) => void;
  setActiveManifest: (manifest: CourseManifest | null) => void;
  setOutputDirectory: (dir: string) => void;
  setMaxResolution: (res: VideoResolution) => void;
  setMaxConcurrentDownloads: (count: number) => void;
  setEnableDownloadDelay: (enabled: boolean) => void;
  setMinDelaySeconds: (secs: number) => void;
  setMaxDelaySeconds: (secs: number) => void;
  setDelayVideosOnly: (videosOnly: boolean) => void;
  setIsDownloading: (isDl: boolean) => void;
  setActiveView: (view: AppView) => void;
  openCoursePlayer: (course: PlayerCourseRef) => void;
  openCoursePreview: (slug: string, title?: string) => void;
  closeCoursePlayer: () => void;
  toggleBookmark: (b: Omit<Bookmark, "savedAt">) => void;
  removeBookmark: (kind: Bookmark["kind"], slug: string) => void;
  setBrowsingSpec: (spec: BrowsingSpec | null) => void;
  setPlayerPrefs: (prefs: Partial<PlayerPrefs>) => void;
  updateProgress: (event: DownloadProgressEvent) => void;
  resetDownloads: () => void;
  clearAllUserData: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      user: null,
      enrolledCourses: [],
      coursesCache: {},
      lastCoursesFetchedAt: {},
      downloadStatusMap: {},
      activeManifest: null,
      outputDirectory: "~/Downloads/Coursera",
      maxResolution: 720,
      maxConcurrentDownloads: 4,
      enableDownloadDelay: false,
      minDelaySeconds: 2,
      maxDelaySeconds: 5,
      delayVideosOnly: false,
      isDownloading: false,
      activeView: "courses",
      playerCourse: null,
      playerReturnView: "downloads",
      bookmarks: [],
      browsingSpec: null,
      playerPrefs: {
        playbackRate: 1,
        captionsEnabled: true,
        autoplayNext: true,
        transcriptAutoScroll: true,
        ttsVoiceURI: null,
        ttsRate: 1,
      },
      currentProgress: null,
      liveTasks: {},

      setUser: (user) => set({ user }),
      setEnrolledCourses: (enrolledCourses) => set({ enrolledCourses }),
      setCachedCoursesForUser: (userId, courses) =>
        set((state) => ({
          enrolledCourses: courses,
          coursesCache: {
            ...state.coursesCache,
            [userId]: courses,
          },
        })),
      setLastCoursesFetchedAt: (userId, timestamp) =>
        set((state) => ({
          lastCoursesFetchedAt: {
            ...state.lastCoursesFetchedAt,
            [userId]: timestamp,
          },
        })),
      setDownloadStatusMap: (downloadStatusMap) =>
        set((state) => ({
          downloadStatusMap: {
            ...state.downloadStatusMap,
            ...downloadStatusMap,
          },
        })),
      updateCourseDownloadStatus: (slug, info) =>
        set((state) => ({
          downloadStatusMap: {
            ...state.downloadStatusMap,
            [slug]: {
              ...(state.downloadStatusMap[slug] || {
                slug,
                course_name: slug,
                path: "",
                total_files: 0,
                downloaded_files: 0,
                total_bytes: 0,
                downloaded_bytes: 0,
                percent: 0,
                status: "not_downloaded",
                is_completed: false,
                last_updated: Date.now(),
              }),
              ...info,
            },
          },
        })),
      setActiveManifest: (activeManifest) => {
        const liveTasks: Record<string, DownloadTask> = {};
        if (activeManifest) {
          activeManifest.tasks.forEach((t) => {
            liveTasks[t.id] = { ...t };
          });
        }
        set({ activeManifest, liveTasks });
      },
      setOutputDirectory: (outputDirectory) => set({ outputDirectory }),
      setMaxResolution: (maxResolution) => set({ maxResolution }),
      setMaxConcurrentDownloads: (maxConcurrentDownloads) => set({ maxConcurrentDownloads }),
      setEnableDownloadDelay: (enableDownloadDelay) => set({ enableDownloadDelay }),
      setMinDelaySeconds: (minDelaySeconds) => set({ minDelaySeconds }),
      setMaxDelaySeconds: (maxDelaySeconds) => set({ maxDelaySeconds }),
      setDelayVideosOnly: (delayVideosOnly) => set({ delayVideosOnly }),
      setIsDownloading: (isDownloading) => set({ isDownloading }),
      setActiveView: (activeView) => set({ activeView }),
      openCoursePlayer: (playerCourse) =>
        set((state) => ({
          playerCourse: { mode: "local", ...playerCourse },
          activeView: "player",
          playerReturnView: state.activeView === "player" ? state.playerReturnView : state.activeView,
        })),
      openCoursePreview: (slug, title) =>
        set((state) => ({
          playerCourse: { mode: "preview", slug, title },
          activeView: "player",
          playerReturnView: state.activeView === "player" ? state.playerReturnView : state.activeView,
        })),
      closeCoursePlayer: () => set((state) => ({ activeView: state.playerReturnView || "downloads" })),
      toggleBookmark: (b) =>
        set((state) => {
          const exists = state.bookmarks.some((x) => x.kind === b.kind && x.slug === b.slug);
          return {
            bookmarks: exists
              ? state.bookmarks.filter((x) => !(x.kind === b.kind && x.slug === b.slug))
              : [{ ...b, savedAt: Date.now() }, ...state.bookmarks],
          };
        }),
      removeBookmark: (kind, slug) =>
        set((state) => ({ bookmarks: state.bookmarks.filter((x) => !(x.kind === kind && x.slug === slug)) })),
      setBrowsingSpec: (browsingSpec) => set({ browsingSpec }),
      setPlayerPrefs: (prefs) => set((state) => ({ playerPrefs: { ...state.playerPrefs, ...prefs } })),
      updateProgress: (event) =>
        set((state) => {
          if (event.task_id === "all") {
            return {
              currentProgress: event,
              isDownloading: false,
            };
          }
          const task = state.liveTasks[event.task_id];
          const updatedTasks = {
            ...state.liveTasks,
            [event.task_id]: {
              ...(task || {
                id: event.task_id,
                title: event.current_file,
                url: "",
                relative_path: "",
                error: null,
              }),
              status: event.status,
              downloaded_bytes: event.downloaded_bytes,
              total_bytes: event.total_bytes,
              error: event.error,
            },
          };
          return {
            currentProgress: event,
            liveTasks: updatedTasks,
          };
        }),
      resetDownloads: () =>
        set({
          activeManifest: null,
          currentProgress: null,
          liveTasks: {},
          isDownloading: false,
        }),
      clearAllUserData: () =>
        set({
          user: null,
          enrolledCourses: [],
          coursesCache: {},
          lastCoursesFetchedAt: {},
          downloadStatusMap: {},
          activeManifest: null,
          currentProgress: null,
          liveTasks: {},
          isDownloading: false,
          activeView: "courses",
        }),
    }),
    {
      name: "coursera-studio-storage",
      partialize: (state) => ({
        outputDirectory: state.outputDirectory,
        maxResolution: state.maxResolution,
        maxConcurrentDownloads: state.maxConcurrentDownloads,
        enableDownloadDelay: state.enableDownloadDelay,
        minDelaySeconds: state.minDelaySeconds,
        maxDelaySeconds: state.maxDelaySeconds,
        delayVideosOnly: state.delayVideosOnly,
        coursesCache: state.coursesCache,
        lastCoursesFetchedAt: state.lastCoursesFetchedAt,
        downloadStatusMap: state.downloadStatusMap,
        playerCourse: state.playerCourse,
        playerPrefs: state.playerPrefs,
        bookmarks: state.bookmarks,
      }),
    }
  )
);
