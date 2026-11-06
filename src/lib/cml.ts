/**
 * Converts Coursera Markup Language (CML) — the XML format readings are stored in — into safe HTML.
 * Only an allowlist of elements/attributes is emitted; everything else is reduced to its text.
 */

export interface CmlContext {
  /** Resolve an asset id (from `<img assetId>` / `<asset id>`) to a loadable URL, or null if not downloaded. */
  assetUrl: (id: string) => string | null;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const safeHref = (href: string | null) => {
  if (!href) return null;
  const h = href.trim();
  return /^(https?:|mailto:)/i.test(h) ? h : null;
};

function renderChildren(node: Node, ctx: CmlContext): string {
  let out = "";
  node.childNodes.forEach((c) => (out += renderNode(c, ctx)));
  return out;
}

function renderNode(node: Node, ctx: CmlContext): string {
  if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
    return esc(node.textContent || "");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const inner = () => renderChildren(el, ctx);

  switch (tag) {
    case "co-content":
    case "root":
      return inner();
    case "text": {
      const content = inner();
      return content.trim() ? `<p>${content}</p>` : "";
    }
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(el.getAttribute("level")) || 2)) + 1;
      return `<h${Math.min(level, 6)}>${inner()}</h${Math.min(level, 6)}>`;
    }
    case "list": {
      const t = (el.getAttribute("bullettype") || el.getAttribute("bulletType") || "").toLowerCase();
      const ordered = t.includes("number") || t.includes("ordered");
      return ordered ? `<ol>${inner()}</ol>` : `<ul>${inner()}</ul>`;
    }
    case "li":
      return `<li>${inner()}</li>`;
    case "strong":
    case "b":
      return `<strong>${inner()}</strong>`;
    case "em":
    case "i":
      return `<em>${inner()}</em>`;
    case "u":
      return `<u>${inner()}</u>`;
    case "s":
    case "strike":
      return `<s>${inner()}</s>`;
    case "sub":
    case "sup":
      return `<${tag}>${inner()}</${tag}>`;
    case "br":
      return "<br/>";
    case "hr":
      return "<hr/>";
    case "a": {
      const href = safeHref(el.getAttribute("href"));
      return href
        ? `<a href="${esc(href)}" data-external="true">${inner()}</a>`
        : inner();
    }
    case "code": {
      const lang = el.getAttribute("language") || "";
      const code = esc(el.textContent || "");
      // Inline when inside a text paragraph, block otherwise
      const parentTag = el.parentElement?.tagName.toLowerCase();
      if (parentTag === "text" || parentTag === "li") return `<code>${code}</code>`;
      return `<pre data-lang="${esc(lang)}"><code>${code}</code></pre>`;
    }
    case "img": {
      const id = el.getAttribute("assetId") || el.getAttribute("assetid") || "";
      const alt = esc(el.getAttribute("alt") || "");
      const src = id ? ctx.assetUrl(id) : safeHref(el.getAttribute("src"));
      return src
        ? `<figure><img src="${esc(src)}" alt="${alt}" loading="lazy"/></figure>`
        : `<div class="cml-missing">Image not downloaded yet</div>`;
    }
    case "asset": {
      const id = el.getAttribute("id") || "";
      const name = el.getAttribute("name") || "Attachment";
      const ext = (el.getAttribute("extension") || "").toLowerCase();
      const url = id ? ctx.assetUrl(id) : null;
      const label = `${esc(name)}${ext ? `.${esc(ext)}` : ""}`;
      return url
        ? `<div class="cml-asset" data-asset-id="${esc(id)}" data-ext="${esc(ext)}"><span class="cml-asset-icon">${esc(ext.toUpperCase() || "FILE")}</span><span class="cml-asset-name">${label}</span><span class="cml-asset-action">Open</span></div>`
        : `<div class="cml-asset cml-missing"><span class="cml-asset-icon">${esc(ext.toUpperCase() || "FILE")}</span><span class="cml-asset-name">${label}</span><span class="cml-asset-action">Not downloaded</span></div>`;
    }
    case "table":
      return `<div class="cml-table"><table>${inner()}</table></div>`;
    case "thead":
    case "tbody":
    case "tr":
      return `<${tag}>${inner()}</${tag}>`;
    case "td":
    case "th":
      return `<${tag}>${inner()}</${tag}>`;
    case "var":
      return `<var>${inner()}</var>`;
    default:
      return inner();
  }
}

/** True when the file content looks like CML rather than plain HTML. */
export function isCml(raw: string): boolean {
  return /<co-content[\s>]/.test(raw) || /^\s*<(text|heading|list)\b/.test(raw);
}

export function cmlToHtml(raw: string, ctx: CmlContext): string {
  const doc = new DOMParser().parseFromString(`<root>${raw}</root>`, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) {
    // Malformed XML — fall back to lenient HTML parsing of the same markup
    const html = new DOMParser().parseFromString(raw, "text/html");
    return renderChildren(html.body, ctx);
  }
  return renderChildren(doc.documentElement, ctx);
}

/** Sanitize arbitrary HTML (non-CML readings) by passing it through the same allowlist renderer. */
export function sanitizeHtml(raw: string, ctx: CmlContext): string {
  const html = new DOMParser().parseFromString(raw, "text/html");
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return esc(node.textContent || "");
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const kids = () => {
      let s = "";
      el.childNodes.forEach((c) => (s += walk(c)));
      return s;
    };
    if (["script", "style", "iframe", "object", "embed", "noscript"].includes(tag)) return "";
    if (/^h[1-6]$/.test(tag) || ["p", "ul", "ol", "li", "strong", "em", "u", "s", "sub", "sup", "pre", "code", "blockquote", "table", "thead", "tbody", "tr", "td", "th", "figure"].includes(tag)) {
      return `<${tag}>${kids()}</${tag}>`;
    }
    if (tag === "br" || tag === "hr") return `<${tag}/>`;
    if (tag === "a") {
      const href = safeHref(el.getAttribute("href"));
      return href ? `<a href="${esc(href)}" data-external="true">${kids()}</a>` : kids();
    }
    if (tag === "img") {
      const src = safeHref(el.getAttribute("src"));
      return src ? `<img src="${esc(src)}" alt="${esc(el.getAttribute("alt") || "")}"/>` : "";
    }
    return kids();
  };
  return walk(html.body) || renderChildren(html.body, ctx);
}
