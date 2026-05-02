/**
 * Extract candidate listing-photo URLs from a listing page's raw HTML.
 *
 * We only get one shot per candidate at the visual-verification step, so the
 * order matters — the highest-scoring URLs come first. Scoring is intentionally
 * heuristic and lenient; better to send a few extra URLs than to miss the
 * actual interior shots.
 */

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif)(?:\?|#|$)/i;
const IMAGE_PATH_RE = /\/(image|photo|media|gallery|asset|cdn)\b/i;

const SKIP_RE =
  /(logo|favicon|icon|avatar|sprite|pixel|tracking|spinner|placeholder|share[-_]|button|email|phone)/i;

const PREFER_RE =
  /(gallery|interior|kitchen|living|bedroom|bathroom|unit|apartment|view|amenity|floor[-_]?plan|hero|tour)/i;

const META_OG_IMAGE_RE_A =
  /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/gi;
const META_OG_IMAGE_RE_B =
  /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/gi;
const IMG_SRC_RE = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
const IMG_DATA_SRC_RE = /<img[^>]+data-src=["']([^"']+)["'][^>]*>/gi;
const SRCSET_RE = /(?:srcset|data-srcset)=["']([^"']+)["']/gi;
const SOURCE_SRC_RE = /<source[^>]+srcset=["']([^"']+)["']/gi;

interface Candidate {
  url: string;
  score: number;
  rank: number;
}

export function extractListingImageUrls(
  html: string,
  baseUrl: string,
): string[] {
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  let rank = 0;

  let base: URL | null = null;
  try {
    base = new URL(baseUrl);
  } catch {
    base = null;
  }

  function add(raw: string) {
    rank++;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("data:")) return;

    let abs: string;
    try {
      abs = new URL(trimmed, base ?? undefined).toString();
    } catch {
      return;
    }
    if (seen.has(abs)) return;
    seen.add(abs);

    // Must look like an image URL — either by extension or by an
    // image-suggesting path segment (CDN URLs often hide the extension).
    if (!IMAGE_EXT_RE.test(abs) && !IMAGE_PATH_RE.test(abs)) return;

    if (SKIP_RE.test(abs)) return;

    let score = 50;
    if (PREFER_RE.test(abs)) score += 40;
    if (IMAGE_EXT_RE.test(abs)) score += 10;
    if (abs.startsWith("https://")) score += 5;

    candidates.push({ url: abs, score, rank });
  }

  // og:image is usually the hero/exterior shot
  for (const m of html.matchAll(META_OG_IMAGE_RE_A)) add(m[1]);
  for (const m of html.matchAll(META_OG_IMAGE_RE_B)) add(m[1]);

  // <img src="..."> and lazy-load <img data-src="...">
  for (const m of html.matchAll(IMG_SRC_RE)) add(m[1]);
  for (const m of html.matchAll(IMG_DATA_SRC_RE)) add(m[1]);

  // <source srcset="..."> inside <picture> blocks
  for (const m of html.matchAll(SOURCE_SRC_RE)) {
    const first = firstFromSrcset(m[1]);
    if (first) add(first);
  }

  // Generic srcset on <img> or <source>
  for (const m of html.matchAll(SRCSET_RE)) {
    const first = firstFromSrcset(m[1]);
    if (first) add(first);
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.rank - b.rank;
  });

  return candidates.map((c) => c.url);
}

function firstFromSrcset(srcset: string): string | null {
  const first = srcset.split(",")[0]?.trim();
  if (!first) return null;
  return first.split(/\s+/)[0] ?? null;
}
