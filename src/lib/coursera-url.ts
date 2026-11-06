export type CourseraInputKind = "course" | "spec";

export interface ParsedCourseraInput {
  kind: CourseraInputKind | null; // null → plain slug, type unknown
  slug: string;
  /** Human label for what was detected. */
  label: "Course" | "Specialization" | "Professional Certificate" | null;
}

/**
 * Accepts a Coursera URL (any of /learn, /specializations, /professional-certificates, with or
 * without query/hash/trailing paths) or a bare slug.
 */
export function parseCourseraInput(input: string): ParsedCourseraInput {
  const text = input.trim();
  if (!text) return { kind: null, slug: "", label: null };

  let path = text;
  try {
    if (/^(https?:\/\/|www\.|coursera\.org)/i.test(text)) {
      const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
      path = url.pathname;
    }
  } catch {
    // not a URL — treat as path/slug
  }
  path = path.split(/[?#]/)[0].replace(/^\/+|\/+$/g, "");
  const parts = path.split("/").filter(Boolean);

  const after = (key: string) => {
    const i = parts.indexOf(key);
    return i !== -1 && parts[i + 1] ? decodeURIComponent(parts[i + 1]) : null;
  };

  const learn = after("learn");
  if (learn) return { kind: "course", slug: learn, label: "Course" };
  const spec = after("specializations");
  if (spec) return { kind: "spec", slug: spec, label: "Specialization" };
  const cert = after("professional-certificates");
  if (cert) return { kind: "spec", slug: cert, label: "Professional Certificate" };

  // Bare slug (take the last path segment if someone pasted "learn/foo" without a host)
  return { kind: null, slug: parts[parts.length - 1] || text, label: null };
}
