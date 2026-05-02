import type { FetchedPage } from "./types";

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_HTML_BYTES = 250_000; // 250KB raw HTML
const DEFAULT_MAX_TEXT_CHARS = 10_000; // ~2500–3000 tokens; listicles name many buildings

const USER_AGENT =
  "Mozilla/5.0 (compatible; ApartmentDecoder/0.1; +https://apartment-decoder.local)";

interface FetchPageOptions {
  timeoutMs?: number;
  maxHtmlBytes?: number;
  maxTextChars?: number;
}

/**
 * Fetch a URL and extract a plain-text representation of the page so the
 * candidate-analysis model can read what's actually on the listing page,
 * not just the search snippet. The building name is almost always in the
 * `<title>` or first heading even when it's missing from Google's snippet.
 *
 * Failure modes (timeouts, 403s, non-HTML content) return a FetchedPage
 * with `error` set and an empty content string — never throw.
 */
export async function fetchPage(
  url: string,
  opts: FetchPageOptions = {},
): Promise<FetchedPage> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxHtmlBytes = opts.maxHtmlBytes ?? DEFAULT_MAX_HTML_BYTES;
  const maxTextChars = opts.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const fetchedAt = new Date().toISOString();

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!res.ok) {
      return {
        url,
        title: null,
        content: "",
        htmlBytes: 0,
        fetchedAt,
        error: `HTTP ${res.status} ${res.statusText}`,
      };
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!/html|xml|text/i.test(contentType)) {
      return {
        url,
        title: null,
        content: "",
        htmlBytes: 0,
        fetchedAt,
        error: `Non-HTML content type: ${contentType}`,
      };
    }

    // Stream-cap by reading at most maxHtmlBytes. We keep the rest discarded
    // so we don't blow memory on a multi-MB page.
    const reader = res.body?.getReader();
    if (!reader) {
      return {
        url,
        title: null,
        content: "",
        htmlBytes: 0,
        fetchedAt,
        error: "Response had no body",
      };
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < maxHtmlBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const room = maxHtmlBytes - total;
      if (value.byteLength <= room) {
        chunks.push(value);
        total += value.byteLength;
      } else {
        chunks.push(value.subarray(0, room));
        total += room;
        break;
      }
    }
    // Best-effort cancel — we got what we needed.
    void reader.cancel().catch(() => {});

    const buf = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      buf.set(c, offset);
      offset += c.byteLength;
    }
    const html = new TextDecoder("utf-8", { fatal: false }).decode(buf);

    return {
      url,
      title: extractTitle(html),
      content: htmlToText(html).slice(0, maxTextChars),
      htmlBytes: total,
      fetchedAt,
    };
  } catch (err) {
    const e = err as Error;
    const message =
      e.name === "AbortError" ? `Timeout after ${timeoutMs}ms` : e.message;
    return {
      url,
      title: null,
      content: "",
      htmlBytes: 0,
      fetchedAt,
      error: message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sibling of fetchPage that returns the raw HTML string. Used by the
 * visual-verification step which needs to extract <img> URLs, not strip them.
 */
export async function fetchHtml(
  url: string,
  opts: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<{ html: string; bytes: number } | null> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_HTML_BYTES;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) return null;

    const ct = res.headers.get("content-type") ?? "";
    if (!/html|xml|text/i.test(ct)) return null;

    const reader = res.body?.getReader();
    if (!reader) return null;

    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const room = maxBytes - total;
      if (value.byteLength <= room) {
        chunks.push(value);
        total += value.byteLength;
      } else {
        chunks.push(value.subarray(0, room));
        total += room;
        break;
      }
    }
    void reader.cancel().catch(() => {});

    const buf = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      buf.set(c, offset);
      offset += c.byteLength;
    }
    const html = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    return { html, bytes: total };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch an image URL and return it as a `data:` URL the vision model can
 * consume. Returns null on any failure (timeout, non-image content type,
 * too large, network error, etc.) — never throws.
 */
export async function fetchImageAsDataUrl(
  url: string,
  opts: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<string | null> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? 3_000_000; // 3MB raw image cap

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) return null;

    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    const mime = ct.split(";")[0].trim();
    if (!/^image\//.test(mime)) return null;
    // Vision models accept these; bail on weird formats (svg, ico).
    if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(mime)) return null;

    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > maxBytes) return null;

    const b64 = Buffer.from(buf).toString("base64");
    // Vision models choke on AVIF in some cases; rebrand AVIF as JPEG MIME
    // is not safe (it's actually AVIF bytes). Just pass through honestly —
    // if the model rejects it, the verification will surface as an error.
    return `data:${mime};base64,${b64}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchPages(
  urls: string[],
  opts?: FetchPageOptions,
): Promise<FetchedPage[]> {
  if (urls.length === 0) return [];
  const results = await Promise.allSettled(
    urls.map((u) => fetchPage(u, opts)),
  );
  return results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : {
          url: urls[i] ?? "",
          title: null,
          content: "",
          htmlBytes: 0,
          fetchedAt: new Date().toISOString(),
          error: (r.reason as Error)?.message ?? "Unknown fetch failure",
        },
  );
}

/**
 * Naive registrable host key for per-session 403 blocking (last two DNS
 * labels, strip leading `www.`). Good enough for `.com` listing sites.
 */
export function registrableHostKey(hostname: string): string {
  const h = hostname.toLowerCase().replace(/^www\./, "");
  const parts = h.split(".");
  if (parts.length <= 2) return h;
  return parts.slice(-2).join(".");
}

/**
 * Fetch listing pages sequentially. If a URL returns HTTP 403, the host key
 * (see `registrableHostKey`) is blocked for the rest of this run — we skip
 * any later candidate URL on the same domain. Stops after `maxPages` fetch
 * attempts (each attempt produces one `FetchedPage`, success or error).
 */
export async function fetchPagesRespectingHost403(
  urls: string[],
  maxPages: number,
  opts?: FetchPageOptions,
): Promise<FetchedPage[]> {
  if (urls.length === 0 || maxPages <= 0) return [];
  const blockedHosts = new Set<string>();
  const out: FetchedPage[] = [];

  for (const url of urls) {
    if (out.length >= maxPages) break;
    let key: string;
    try {
      key = registrableHostKey(new URL(url).hostname);
    } catch {
      continue;
    }
    if (blockedHosts.has(key)) continue;

    const page = await fetchPage(url, opts);
    out.push(page);
    if (page.error && /\b403\b/.test(page.error)) {
      blockedHosts.add(key);
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// HTML → text helpers (intentionally simple — good enough for listing pages)
// ---------------------------------------------------------------------------

const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const SCRIPT_RE = /<script[\s\S]*?<\/script>/gi;
const STYLE_RE = /<style[\s\S]*?<\/style>/gi;
const NOSCRIPT_RE = /<noscript[\s\S]*?<\/noscript>/gi;
const SVG_RE = /<svg[\s\S]*?<\/svg>/gi;
const COMMENT_RE = /<!--[\s\S]*?-->/g;
const TAG_RE = /<[^>]+>/g;
const WHITESPACE_RE = /\s+/g;

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  copy: "©",
  reg: "®",
  trade: "™",
};

export function extractTitle(html: string): string | null {
  const m = html.match(TITLE_RE);
  if (!m) return null;
  return decodeEntities(m[1]).trim().replace(WHITESPACE_RE, " ") || null;
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(SCRIPT_RE, " ")
      .replace(STYLE_RE, " ")
      .replace(NOSCRIPT_RE, " ")
      .replace(SVG_RE, " ")
      .replace(COMMENT_RE, " ")
      // Convert block-level closes to newlines so we don't smush sections together.
      .replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer)\s*>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(TAG_RE, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      safeFromCharCode(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) => safeFromCharCode(parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (full, name: string) => {
      const v = NAMED_ENTITIES[name.toLowerCase()];
      return v ?? full;
    });
}

function safeFromCharCode(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}
