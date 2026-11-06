export interface Cue {
  start: number;
  end: number;
  text: string;
}

function parseTimestamp(ts: string): number {
  // 00:01:02,345 | 00:01:02.345 | 01:02.345
  const m = ts.trim().match(/(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/);
  if (!m) return NaN;
  const [, h, min, s, ms] = m;
  return (Number(h || 0) * 3600) + Number(min) * 60 + Number(s) + Number(ms.padEnd(3, "0")) / 1000;
}

/** Parses SRT or WebVTT text into cues. Tolerates CRLF, BOM, cue settings and inline tags. */
export function parseSubtitles(raw: string): Cue[] {
  const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const blocks = text.split(/\n{2,}/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    const timingIdx = lines.findIndex((l) => l.includes("-->"));
    if (timingIdx === -1) continue;
    const [startRaw, endRaw] = lines[timingIdx].split("-->");
    const start = parseTimestamp(startRaw);
    const end = parseTimestamp(endRaw.trim().split(/\s+/)[0]);
    if (isNaN(start) || isNaN(end)) continue;
    const body = lines
      .slice(timingIdx + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (body) cues.push({ start, end, text: body });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/** Index of the cue active at time `t` (binary search), or -1. */
export function activeCueIndex(cues: Cue[], t: number): number {
  let lo = 0;
  let hi = cues.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found !== -1 && t <= cues[found].end + 0.25) return found;
  return -1;
}

/** Groups cues into readable transcript paragraphs (breaks on sentence end after ~6 cues or long pauses). */
export function groupIntoParagraphs(cues: Cue[]): number[][] {
  const paras: number[][] = [];
  let cur: number[] = [];
  cues.forEach((cue, i) => {
    cur.push(i);
    const next = cues[i + 1];
    const sentenceEnd = /[.?!]["')\]]?$/.test(cue.text);
    const pause = next ? next.start - cue.end > 2 : true;
    if ((cur.length >= 6 && sentenceEnd) || cur.length >= 14 || pause) {
      paras.push(cur);
      cur = [];
    }
  });
  if (cur.length) paras.push(cur);
  return paras;
}
