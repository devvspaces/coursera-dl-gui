/**
 * Read-aloud engine on top of the Web Speech API (system voices, works offline in the macOS webview).
 * Text is spoken sentence by sentence so we can highlight progress, skip, jump and change speed
 * mid-way. "Pause" is implemented as cancel + remember position because WebKit's native
 * pause/resume is unreliable.
 */

export interface TtsSegment {
  block: HTMLElement;
  text: string;
  start: number; // char offset within block.textContent
  end: number;
}

export type TtsState = "idle" | "playing" | "paused";

export const ttsSupported = () =>
  typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

const BLOCK_SELECTOR = "p, li, h1, h2, h3, h4, h5, h6, td, th, figcaption, blockquote, [data-tts-block]";

function splitSentences(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  type SegmenterCtor = new (
    locale: string | undefined,
    opts: { granularity: "sentence" }
  ) => { segment: (t: string) => Iterable<{ segment: string; index: number }> };
  const Seg = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
  if (Seg) {
    const seg = new Seg(undefined, { granularity: "sentence" });
    for (const s of seg.segment(text)) {
      if (s.segment.trim()) out.push({ start: s.index, end: s.index + s.segment.length });
    }
    return out;
  }
  const re = /[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) if (m[0].trim()) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

/** Collect speakable sentences from a rendered container, in reading order. */
export function collectSegments(root: HTMLElement): TtsSegment[] {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)).filter(
    // keep innermost blocks only (e.g. a <p> inside an <li>)
    (el) => !el.querySelector(BLOCK_SELECTOR) && !el.closest("[data-tts-skip]")
  );
  const segs: TtsSegment[] = [];
  for (const block of blocks) {
    const text = block.textContent || "";
    if (!text.trim()) continue;
    for (const s of splitSentences(text)) {
      segs.push({ block, text: text.slice(s.start, s.end).trim(), start: s.start, end: s.end });
    }
  }
  return segs;
}

/** DOM Range covering [start, end) characters of `block`'s text. */
function rangeFor(block: HTMLElement, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let pos = 0;
  let startSet = false;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const len = node.textContent?.length || 0;
    if (!startSet && start <= pos + len) {
      range.setStart(node, Math.max(0, start - pos));
      startSet = true;
    }
    if (startSet && end <= pos + len) {
      range.setEnd(node, Math.max(0, end - pos));
      return range;
    }
    pos += len;
  }
  return startSet ? range : null;
}

type HighlightRegistry = { set: (k: string, v: unknown) => void; delete: (k: string) => void };
const highlights = (): HighlightRegistry | null =>
  (globalThis as unknown as { CSS?: { highlights?: HighlightRegistry } }).CSS?.highlights ?? null;
const HighlightCtor = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;

export interface TtsOptions {
  voiceURI?: string | null;
  rate: number;
  onState: (s: TtsState) => void;
  onIndex: (i: number, total: number) => void;
}

export class TtsReader {
  private segments: TtsSegment[] = [];
  private index = 0;
  private token = 0;
  private state: TtsState = "idle";
  private activeBlock: HTMLElement | null = null;
  constructor(private opts: TtsOptions) {}

  load(root: HTMLElement) {
    this.stop();
    this.segments = collectSegments(root);
    this.index = 0;
    this.opts.onIndex(0, this.segments.length);
  }

  get total() {
    return this.segments.length;
  }

  setOptions(partial: Partial<Pick<TtsOptions, "voiceURI" | "rate">>) {
    const changed = partial.rate !== this.opts.rate || partial.voiceURI !== this.opts.voiceURI;
    this.opts = { ...this.opts, ...partial };
    if (changed && this.state === "playing") this.speakCurrent();
  }

  play(from?: number) {
    if (!this.segments.length) return;
    if (from !== undefined) this.index = Math.max(0, Math.min(from, this.segments.length - 1));
    if (this.index >= this.segments.length) this.index = 0;
    this.setState("playing");
    this.speakCurrent();
  }

  pause() {
    if (this.state !== "playing") return;
    this.token++;
    window.speechSynthesis.cancel();
    this.setState("paused");
  }

  toggle() {
    if (this.state === "playing") this.pause();
    else this.play();
  }

  stop() {
    this.token++;
    if (ttsSupported()) window.speechSynthesis.cancel();
    this.clearHighlight();
    this.index = 0;
    this.setState("idle");
  }

  next() {
    this.jump(this.index + 1);
  }

  prev() {
    this.jump(this.index - 1);
  }

  /** Start reading from the first sentence inside the given element. */
  playFromElement(el: Element) {
    const i = this.segments.findIndex((s) => s.block === el || el.contains(s.block) || s.block.contains(el));
    if (i !== -1) this.play(i);
  }

  private jump(i: number) {
    if (!this.segments.length) return;
    this.index = Math.max(0, Math.min(i, this.segments.length - 1));
    if (this.state === "playing") this.speakCurrent();
    else this.highlight(this.segments[this.index]);
    this.opts.onIndex(this.index, this.segments.length);
  }

  private speakCurrent() {
    const synth = window.speechSynthesis;
    const my = ++this.token;
    synth.cancel();
    const seg = this.segments[this.index];
    if (!seg) {
      this.finish();
      return;
    }
    this.highlight(seg);
    this.opts.onIndex(this.index, this.segments.length);

    const u = new SpeechSynthesisUtterance(seg.text);
    u.rate = this.opts.rate;
    const voice = synth.getVoices().find((v) => v.voiceURI === this.opts.voiceURI);
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    }
    u.onend = () => {
      if (my !== this.token) return;
      this.index++;
      if (this.index >= this.segments.length) this.finish();
      else this.speakCurrent();
    };
    u.onerror = (e) => {
      if (my !== this.token) return;
      if (e.error === "interrupted" || e.error === "canceled") return;
      this.index++;
      this.speakCurrent();
    };
    // WebKit occasionally drops an utterance queued in the same tick as cancel()
    setTimeout(() => my === this.token && synth.speak(u), 30);
  }

  private finish() {
    this.clearHighlight();
    this.index = 0;
    this.setState("idle");
  }

  private highlight(seg: TtsSegment) {
    if (this.activeBlock !== seg.block) {
      this.activeBlock?.classList.remove("tts-active-block");
      seg.block.classList.add("tts-active-block");
      this.activeBlock = seg.block;
    }
    const reg = highlights();
    if (reg && HighlightCtor) {
      const r = rangeFor(seg.block, seg.start, seg.end);
      if (r) reg.set("tts-sentence", new HighlightCtor(r));
    }
    const rect = seg.block.getBoundingClientRect();
    if (rect.top < 80 || rect.bottom > window.innerHeight - 120) {
      seg.block.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  private clearHighlight() {
    this.activeBlock?.classList.remove("tts-active-block");
    this.activeBlock = null;
    highlights()?.delete("tts-sentence");
  }

  private setState(s: TtsState) {
    this.state = s;
    this.opts.onState(s);
  }
}

/** Voices sorted with the best English voices first (Premium/Enhanced, then Siri/Samantha). */
export function rankVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const score = (v: SpeechSynthesisVoice) => {
    let s = 0;
    if (v.lang.toLowerCase().startsWith("en")) s += 100;
    if (/premium/i.test(v.name)) s += 40;
    if (/enhanced/i.test(v.name)) s += 30;
    if (/siri/i.test(v.name)) s += 20;
    if (/samantha|daniel|karen|moira|ava|zoe|evan|tom/i.test(v.name)) s += 10;
    if (v.localService) s += 5;
    return s;
  };
  return [...voices].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
}
