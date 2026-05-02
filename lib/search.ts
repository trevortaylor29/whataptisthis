import type { QuerySearchResult, SearchHit } from "./types";

const SERPER_URL = "https://google.serper.dev/search";
const SERPER_IMAGES_URL = "https://google.serper.dev/images";

/**
 * Hosts we never want to see in search results — these are gatekept video
 * platforms or social aggregators that don't help us identify a building.
 * Serper has no native domain-exclusion parameter, but it forwards Google
 * operators verbatim, so we append `-site:` exclusions to every query.
 */
export const EXCLUDED_SEARCH_HOSTS = [
  "tiktok.com",
  "instagram.com",
  "youtube.com",
  "facebook.com",
  "threads.com",
  "twitter.com",
  "x.com",
  "reddit.com",
] as const;

const EXCLUSION_SUFFIX = EXCLUDED_SEARCH_HOSTS.map((h) => `-site:${h}`).join(
  " ",
);

/**
 * Major listing aggregators that often return HTTP 403 to server-side scrapers
 * (Cloudflare / bot protection). We still let them appear in search results,
 * but rank them *lower* for the HTML fetch step so we try fetchable sites first.
 */
const DEPRIORITIZED_FETCH_AGGREGATORS = [
  "apartments.com",
  "zillow.com",
  "trulia.com",
  "hotpads.com",
  "realtor.com",
  "apartmentguide.com",
  "padmapper.com",
  "rent.com",
] as const;

/**
 * Sites that typically allow our fetches through and often name the building
 * (mid-tier aggregators, property CMS hosts).
 */
const PREFERRED_FETCH_HOSTS = [
  "rentcafe.com",
  "zumper.com",
  "apartmentlist.com",
  "forrent.com",
] as const;

/**
 * Hosts that should not be considered as fetch targets at all (defensive —
 * the search exclusions above should already filter these out).
 */
const SOCIAL_AND_VIDEO_HOSTS = [
  "tiktok.com",
  "instagram.com",
  "youtube.com",
  "youtu.be",
  "facebook.com",
  "fb.watch",
  "twitter.com",
  "x.com",
  "reddit.com",
  "pinterest.com",
  "threads.net",
  "threads.com",
  "snapchat.com",
] as const;

export class SearchError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "SearchError";
    this.status = status;
  }
}

interface SerperOrganicResult {
  title?: string;
  link?: string;
  snippet?: string;
  source?: string;
}

interface SerperResponse {
  organic?: SerperOrganicResult[];
  knowledgeGraph?: { title?: string; website?: string; description?: string };
}

/**
 * URL (path/query stripped) looks like a direct document download — not an HTML
 * listing page. Serper often returns `/file.pdf`, `...xlsx?download=1`, etc.
 */
function urlLooksLikeDocumentFile(link: string): boolean {
  const noHash = link.split("#")[0] ?? link;
  const noQuery = noHash.split("?")[0] ?? noHash;
  const tail = noQuery.trim().toLowerCase().replace(/\/+$/, "");
  return /\.(pdf|xlsx|xls|csv|xml|txt|doc|docx)$/i.test(tail);
}

/** Hostnames that are never useful apartment-building evidence. */
const NON_APARTMENT_HOST_SUFFIXES = [
  "archive.org",
  "scribd.com",
  "pinterest.com",
  "unsplash.com",
  "alamy.com",
  "loc.gov",
  "census.gov",
  "data.gov",
  "github.com",
  "wikipedia.org",
  "wikimedia.org",
  "va250.org",
] as const;

function hostLooksNonApartment(hostname: string): boolean {
  const host = hostname.toLowerCase();
  // Government / education (user: "containing .gov, .edu"). Military TLD only
  // as a label suffix — avoid matching e.g. milano.it via a naive ".mil" substring.
  if (host.includes(".gov") || host.includes(".edu")) return true;
  if (host.endsWith(".mil") || host.includes(".mil.")) return true;
  for (const suf of NON_APARTMENT_HOST_SUFFIXES) {
    if (host === suf || host.endsWith(`.${suf}`)) return true;
  }
  return false;
}

/**
 * Drop document URLs and non-apartment hosts immediately after Serper returns,
 * before results hit the AI or fetch ranking.
 */
export function filterJunkSearchHits(hits: SearchHit[]): SearchHit[] {
  return hits.filter((h) => {
    const link = h.link?.trim() ?? "";
    if (!link) return true;
    try {
      const u = new URL(link);
      const host = u.hostname.toLowerCase();
      if (urlLooksLikeDocumentFile(link)) return false;
      if (hostLooksNonApartment(host)) return false;
      return true;
    } catch {
      return false;
    }
  });
}

function applyExclusions(query: string): string {
  // Idempotent — if the user/AI already added a -site: operator we don't
  // double up (rare, but tidy).
  if (query.includes("-site:tiktok.com")) return query;
  return `${query.trim()} ${EXCLUSION_SUFFIX}`;
}

/**
 * Run a single Google web search via Serper. The query is augmented with
 * `-site:` exclusions for social/video hosts. Exported for visual-verification
 * fallbacks (e.g. "{building} {city} apartments photos").
 */
export async function runSerperWebQuery(query: string): Promise<SearchHit[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    throw new SearchError(
      "SERPER_API_KEY is not set. Add it to .env.local or set MOCK_OPENROUTER=1 (which also mocks search).",
      500,
    );
  }

  const augmented = applyExclusions(query);

  const res = await fetch(SERPER_URL, {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: augmented, num: 10, gl: "us", hl: "en" }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new SearchError(
      `Serper request failed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`,
      res.status,
    );
  }

  const data = (await res.json()) as SerperResponse;
  const hits: SearchHit[] = (data.organic ?? []).map((r) => ({
    title: r.title ?? "(no title)",
    link: r.link ?? "",
    snippet: r.snippet ?? "",
    source: r.source,
  }));

  if (data.knowledgeGraph?.website) {
    hits.unshift({
      title: data.knowledgeGraph.title ?? "Knowledge graph result",
      link: data.knowledgeGraph.website,
      snippet: data.knowledgeGraph.description ?? "",
      source: "knowledge_graph",
    });
  }

  return filterJunkSearchHits(hits);
}

interface SerperImageRow {
  imageUrl?: string;
  thumbnailUrl?: string;
  title?: string;
}

interface SerperImageApiResponse {
  images?: SerperImageRow[];
}

/**
 * Google Images search via Serper (`type: images` equivalent — dedicated
 * `/images` endpoint). Returns direct image URLs suitable for downloading.
 */
export async function runSerperImageSearch(
  query: string,
  num = 10,
): Promise<string[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    throw new SearchError(
      "SERPER_API_KEY is not set. Add it to .env.local or set MOCK_OPENROUTER=1 (which also mocks search).",
      500,
    );
  }

  const res = await fetch(SERPER_IMAGES_URL, {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: query.trim(),
      num,
      gl: "us",
      hl: "en",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new SearchError(
      `Serper images request failed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`,
      res.status,
    );
  }

  const data = (await res.json()) as SerperImageApiResponse;
  const out: string[] = [];
  for (const row of data.images ?? []) {
    const u = row.imageUrl || row.thumbnailUrl;
    if (u && /^https?:\/\//i.test(u)) out.push(u);
  }
  return out;
}

/**
 * Run up to `maxQueries` searches sequentially. Sequential keeps us under
 * Serper rate limits and makes errors easier to attribute. The original
 * (un-augmented) query string is preserved on the response so the AI's
 * intent stays visible in the debug panel.
 */
export async function runSearches(
  queries: string[],
  maxQueries = 7,
): Promise<QuerySearchResult[]> {
  const trimmed = queries
    .map((q) => q.trim())
    .filter((q): q is string => q.length > 0)
    .slice(0, maxQueries);

  const out: QuerySearchResult[] = [];
  for (const q of trimmed) {
    try {
      const hits = filterJunkSearchHits(await runSerperWebQuery(q));
      out.push({ query: q, hits });
    } catch (err) {
      out.push({
        query: q,
        hits: [
          {
            title: "(search failed)",
            link: "",
            snippet: (err as Error).message,
          },
        ],
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// URL ranking — pick which listing pages to fetch
// ---------------------------------------------------------------------------

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function endsWithHost(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith("." + suffix);
}

/** URL path segments suggest a locator / listicle / guide page. */
const LOCATOR_PATH_KEYWORDS = [
  "locator",
  "locating",
  "apartment-guide",
  "best-apartments",
  "top-apartments",
  "highrise-apartments",
  "luxury-apartments",
] as const;

const LISTICLE_TITLE_SNIPPET_PHRASES = [
  "top apartments",
  "best apartments",
  "apartment guide",
  "apartment list",
  "high rise apartments in",
  "luxury apartments in",
] as const;

export interface ListingFetchRankEntry {
  url: string;
  score: number;
  firstRank: number;
  title: string;
  snippet: string;
}

function normalizedUrlPathForMatching(url: string): string {
  try {
    const p = new URL(url).pathname.toLowerCase().replace(/_/g, "-");
    return p;
  } catch {
    return "";
  }
}

export function urlPathLooksLikeLocatorOrGuide(url: string): boolean {
  const path = normalizedUrlPathForMatching(url);
  if (!path) return false;
  return LOCATOR_PATH_KEYWORDS.some((k) => path.includes(k));
}

/** Tokens from user city (e.g. "Austin, TX" → austin, …) for snippet/title checks. */
export function cityHintsForFetchMatching(city: string | null | undefined): string[] {
  if (!city?.trim()) return [];
  const t = city.trim().toLowerCase();
  const hints = new Set<string>();
  for (const seg of t.split(",").map((s) => s.trim()).filter(Boolean)) {
    hints.add(seg);
    for (const w of seg.split(/\s+/)) {
      if (w.length >= 3) hints.add(w);
    }
  }
  return [...hints];
}

export function titleSnippetLooksLikeCityListicle(
  title: string,
  snippet: string,
  cityHint: string | null | undefined,
): boolean {
  const hints = cityHintsForFetchMatching(cityHint ?? "");
  if (hints.length === 0) return false;
  const blob = `${title}\n${snippet}`.toLowerCase();
  const hasPhrase = LISTICLE_TITLE_SNIPPET_PHRASES.some((p) => blob.includes(p));
  if (!hasPhrase) return false;
  return hints.some((h) => blob.includes(h));
}

export function hitMatchesListicleOrLocatorSignals(
  hit: Pick<SearchHit, "link" | "title" | "snippet">,
  cityHint?: string | null,
): boolean {
  if (!hit.link?.trim()) return false;
  if (urlPathLooksLikeLocatorOrGuide(hit.link)) return true;
  return titleSnippetLooksLikeCityListicle(
    hit.title ?? "",
    hit.snippet ?? "",
    cityHint,
  );
}

/**
 * Host-only tier before listicle/locator boosts. Social/video = 0;
 * Cloudflare-heavy aggregators = 40; preferred = 100; default = 100.
 */
function scoreHostTierForFetch(url: string): number {
  const host = hostnameOf(url);
  if (!host) return 0;
  if (SOCIAL_AND_VIDEO_HOSTS.some((s) => endsWithHost(host, s))) return 0;
  if (DEPRIORITIZED_FETCH_AGGREGATORS.some((s) => endsWithHost(host, s)))
    return 40;
  if (PREFERRED_FETCH_HOSTS.some((s) => endsWithHost(host, s))) return 100;
  return 100;
}

/**
 * Fetch priority for a search hit. Listicle/locator URL or title+snippet
 * patterns (with city) score 120; otherwise host tier only.
 */
export function scoreSearchHitForFetch(
  hit: SearchHit,
  cityHint?: string | null,
): number {
  const base = scoreHostTierForFetch(hit.link ?? "");
  if (base === 0) return 0;
  if (hitMatchesListicleOrLocatorSignals(hit, cityHint)) return 120;
  return base;
}

/** @deprecated Prefer {@link scoreSearchHitForFetch} when title/snippet exist. */
export function scoreUrlForFetch(url: string): number {
  return scoreSearchHitForFetch(
    { link: url, title: "", snippet: "" },
    null,
  );
}

/**
 * Rank unique listing URLs for HTML fetch: best scores first, then earlier
 * search-hit order. When `cityHint` is set, title/snippet listicle boosts apply.
 */
export function rankListingFetchEntries(
  searchResults: QuerySearchResult[],
  cityHint: string | null | undefined,
  maxCandidates = 50,
): ListingFetchRankEntry[] {
  const seen = new Map<
    string,
    { score: number; firstRank: number; title: string; snippet: string }
  >();
  let globalRank = 0;

  for (const group of searchResults) {
    for (const hit of group.hits) {
      globalRank++;
      if (!hit.link) continue;
      const score = scoreSearchHitForFetch(hit, cityHint);
      if (score === 0) continue;
      const existing = seen.get(hit.link);
      if (!existing) {
        seen.set(hit.link, {
          score,
          firstRank: globalRank,
          title: hit.title ?? "",
          snippet: hit.snippet ?? "",
        });
      } else {
        if (score > existing.score) {
          existing.score = score;
          existing.title = hit.title ?? existing.title;
          existing.snippet = hit.snippet ?? existing.snippet;
        }
      }
    }
  }

  return Array.from(seen.entries())
    .map(([url, v]) => ({
      url,
      score: v.score,
      firstRank: v.firstRank,
      title: v.title,
      snippet: v.snippet,
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.firstRank - b.firstRank;
    })
    .slice(0, maxCandidates);
}

/**
 * Top `primaryCount` URLs by score, then up to `bonusCap` additional URLs
 * (in rank order) that match listicle/locator signals but were not in that
 * slice. Total list length capped at `maxTotal` (default 8).
 */
export function buildAnalyzeFetchUrlList(
  searchResults: QuerySearchResult[],
  cityHint: string | null | undefined,
  options?: {
    primaryCount?: number;
    bonusCap?: number;
    maxTotal?: number;
    maxCandidates?: number;
  },
): string[] {
  const primaryCount = options?.primaryCount ?? 5;
  const bonusCap = options?.bonusCap ?? 3;
  const maxTotal = options?.maxTotal ?? 8;
  const maxCandidates = options?.maxCandidates ?? 50;

  const ranked = rankListingFetchEntries(
    searchResults,
    cityHint,
    maxCandidates,
  );
  const primary = ranked.slice(0, primaryCount);
  const primaryUrls = new Set(primary.map((e) => e.url));
  const bonus: ListingFetchRankEntry[] = [];

  for (let i = primaryCount; i < ranked.length && bonus.length < bonusCap; i++) {
    const e = ranked[i]!;
    if (primaryUrls.has(e.url)) continue;
    if (
      hitMatchesListicleOrLocatorSignals(
        { link: e.url, title: e.title, snippet: e.snippet },
        cityHint,
      )
    ) {
      bonus.push(e);
    }
  }

  return [...primary.map((e) => e.url), ...bonus.map((e) => e.url)].slice(
    0,
    maxTotal,
  );
}

/**
 * Rank unique listing URLs for HTML fetch: best scores first, then earlier
 * search-hit order. Returns up to `maxCandidates` URLs (may be fewer).
 */
export function rankListingFetchUrls(
  searchResults: QuerySearchResult[],
  maxCandidates = 50,
  cityHint?: string | null,
): string[] {
  return rankListingFetchEntries(searchResults, cityHint, maxCandidates).map(
    (e) => e.url,
  );
}

/** @deprecated Prefer `rankListingFetchUrls` + `fetchPagesRespectingHost403`. */
export function pickTopListingUrls(
  searchResults: QuerySearchResult[],
  max = 3,
): string[] {
  return rankListingFetchUrls(searchResults, max);
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

export function buildMockSearchResults(
  queries: string[],
): QuerySearchResult[] {
  return queries.map((query) => ({
    query,
    hits: [
      {
        title: "The Bowie | Downtown Austin Luxury Apartments",
        link: "https://www.thebowie.com",
        snippet:
          "Studios from $1,596. Offering 6 weeks free. High-rise living in downtown Austin with skyline views and floor-to-ceiling windows.",
        source: "thebowie.com",
      },
      {
        title: "The Bowie Apartments — Austin, TX | Apartments.com",
        link: "https://www.apartments.com/the-bowie-austin-tx/abc123/",
        snippet:
          "See all available apartments at The Bowie in Austin, TX. Studio, 1 BR and 2 BR floor plans starting at $1,596.",
        source: "apartments.com",
      },
      {
        title: "Best New Apartments in Downtown Austin (2026 Guide)",
        link: "https://example.com/austin-luxury-apartments",
        snippet:
          "Roundup of new luxury high-rises in downtown Austin including The Bowie, 70 Rainey, and The Independent.",
      },
    ],
  }));
}
