import { extractListingImageUrls } from "./extract-images";
import { fetchHtml, fetchImageAsDataUrl } from "./fetch-page";
import {
  callOpenRouter,
  extractJson,
  mockEnabled,
  MOCK_VISUAL_VERIFICATIONS,
  OpenRouterError,
} from "./openrouter";
import {
  VISUAL_VERIFICATION_SYSTEM_PROMPT,
  buildVisualVerificationUserPrompt,
} from "./prompts";
import {
  runSerperImageSearch,
  runSerperWebQuery,
  scoreSearchHitForFetch,
} from "./search";
import type {
  AnalyzeRequest,
  ApartmentMatch,
  VisualVerification,
  VisualVerificationStatus,
} from "./types";
import {
  adjustConfidence,
  normalizeConfidencePenaltyBucket,
} from "./visual-verification-score";

const MAX_WEBSITE_INTERIOR_URLS = 3;
const MAX_SERPER_INTERIOR_URLS = 3;
const MAX_SERPER_EXTERIOR_URLS = 3;
const SERPER_IMAGE_CANDIDATES = 12;
/** TikTok frames sent into verification compare (cost control). */
const MAX_SOURCE_FRAMES = 3;
const PHOTO_FETCH_TIMEOUT_MS = 6000;
const HTML_FETCH_TIMEOUT_MS = 8000;

export { adjustConfidence } from "./visual-verification-score";

function unverified(
  original: number,
  reason: string,
  trace: string[] = [],
): VisualVerification {
  return {
    status: "UNVERIFIED",
    skipReason: reason,
    reasoning: "",
    matchedFeatures: [],
    mismatchedFeatures: [],
    candidatePhotos: [],
    listingPhotoTrace: trace.length > 0 ? trace : undefined,
    originalConfidence: original,
    adjustedConfidence: original,
  };
}

function candidateDisplayName(match: ApartmentMatch): string {
  return (
    match.name?.trim() ||
    match.address?.trim()?.split(",")[0]?.trim() ||
    "apartment"
  );
}

function isJunkImageUrl(url: string): boolean {
  const u = url.toLowerCase();
  return (
    u.includes("favicon") ||
    u.includes("sprite") ||
    u.includes("pixel") ||
    u.includes("1x1") ||
    u.endsWith(".svg")
  );
}

function normalizeImageUrlKey(url: string): string {
  return url.trim().toLowerCase();
}

function filterSerperImageUrls(raw: string[], cap: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of raw) {
    const t = u.trim();
    if (!/^https?:\/\//i.test(t) || isJunkImageUrl(t)) continue;
    const k = normalizeImageUrlKey(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}

function dedupeAgainst(
  urls: string[],
  cap: number,
  exclude: Set<string>,
): string[] {
  const out: string[] = [];
  for (const u of urls) {
    const k = normalizeImageUrlKey(u);
    if (!k || exclude.has(k)) continue;
    exclude.add(k);
    out.push(u.trim());
    if (out.length >= cap) break;
  }
  return out;
}

interface VerificationReferenceResolution {
  interiorUrls: string[];
  exteriorUrls: string[];
  trace: string[];
  /** For the vision prompt — how reference images were obtained */
  referencePhotoSource: string;
  usedWebsiteInteriors: boolean;
  usedSerperInteriorSearch: boolean;
  usedSerperExteriorSearch: boolean;
}

/**
 * Resolve interior + exterior reference image URLs for visual verification.
 *
 * 1) Candidate website → interior gallery URLs when fetchable.
 * 2) If no usable website interiors: Serper **Images** —
 *    "{name} {city} interior apartment photos" (top 5).
 * 3) Always (live): Serper **Images** — "{name} {city} exterior building"
 *    (top 5, deduped against interiors) so facades can be matched to video.
 * 4) If interiors are still empty: Serper **web** crawl (HTML extract), last resort.
 */
async function resolveVerificationReferenceImages(
  match: ApartmentMatch,
  city: string,
): Promise<VerificationReferenceResolution> {
  const trace: string[] = [];
  const name = candidateDisplayName(match);
  let interiorUrls: string[] = [];
  let usedWebsiteInteriors = false;
  let usedSerperInteriorSearch = false;
  let usedSerperExteriorSearch = false;
  let usedSerperWebHtmlInteriors = false;

  // 1) Direct website — interiors only
  if (match.website?.trim()) {
    const fetched = await fetchHtml(match.website, {
      timeoutMs: HTML_FETCH_TIMEOUT_MS,
    });
    if (fetched) {
      const urls = extractListingImageUrls(fetched.html, match.website).slice(
        0,
        MAX_WEBSITE_INTERIOR_URLS,
      );
      if (urls.length > 0) {
        usedWebsiteInteriors = true;
        interiorUrls = urls;
        trace.push(
          `website: extracted ${urls.length} interior image URL(s) from ${match.website}`,
        );
      } else {
        trace.push(
          `website: fetched HTML from ${match.website} but found no usable image URLs`,
        );
      }
    } else {
      trace.push(`website: could not fetch ${match.website} (403/block/etc.)`);
    }
  } else {
    trace.push("website: (no URL on candidate)");
  }

  if (mockEnabled()) {
    trace.push("Serper fallbacks skipped (MOCK_OPENROUTER=1)");
    return {
      interiorUrls,
      exteriorUrls: [],
      trace,
      referencePhotoSource: usedWebsiteInteriors
        ? "candidate website (interiors only; mock mode)"
        : "(none — mock mode)",
      usedWebsiteInteriors,
      usedSerperInteriorSearch: false,
      usedSerperExteriorSearch: false,
    };
  }

  // 2) Primary fallback — Serper Images (interiors) when website failed / empty
  if (interiorUrls.length === 0) {
    const qIn = `${name} ${city} interior apartment photos`
      .replace(/\s+/g, " ")
      .trim();
    try {
      const raw = await runSerperImageSearch(qIn, SERPER_IMAGE_CANDIDATES);
      interiorUrls = filterSerperImageUrls(raw, MAX_SERPER_INTERIOR_URLS);
      usedSerperInteriorSearch = interiorUrls.length > 0;
      if (interiorUrls.length > 0) {
        trace.push(
          `Serper images (interior) "${qIn}": ${interiorUrls.length} URL(s)`,
        );
      } else {
        trace.push(
          `Serper images (interior) "${qIn}": no usable URLs in response`,
        );
      }
    } catch (e) {
      trace.push(`Serper images (interior): ${(e as Error).message}`);
    }
  }

  const interiorKeys = new Set(
    interiorUrls.map((u) => normalizeImageUrlKey(u)),
  );

  // 3) Serper Images — exteriors (always in live mode; dedupe vs interiors)
  let exteriorUrls: string[] = [];
  const qEx = `${name} ${city} exterior building`.replace(/\s+/g, " ").trim();
  try {
    const raw = await runSerperImageSearch(qEx, SERPER_IMAGE_CANDIDATES);
    exteriorUrls = dedupeAgainst(
      filterSerperImageUrls(raw, SERPER_IMAGE_CANDIDATES),
      MAX_SERPER_EXTERIOR_URLS,
      interiorKeys,
    );
    usedSerperExteriorSearch = exteriorUrls.length > 0;
    if (exteriorUrls.length > 0) {
      trace.push(
        `Serper images (exterior) "${qEx}": ${exteriorUrls.length} URL(s)`,
      );
    } else {
      trace.push(
        `Serper images (exterior) "${qEx}": no usable URLs in response`,
      );
    }
  } catch (e) {
    trace.push(`Serper images (exterior): ${(e as Error).message}`);
  }

  // 4) Last resort — Serper web HTML extract if we still have no interiors
  if (interiorUrls.length === 0) {
    const qPhotos = `${name} ${city} apartments photos`
      .replace(/\s+/g, " ")
      .trim();
    try {
      const hits = await runSerperWebQuery(qPhotos);
      const sorted = [...hits]
        .filter((h) => h.link && scoreSearchHitForFetch(h, city) > 0)
        .sort(
          (a, b) =>
            scoreSearchHitForFetch(b, city) - scoreSearchHitForFetch(a, city),
        );
      for (const hit of sorted.slice(0, 10)) {
        if (!hit.link) continue;
        const page = await fetchHtml(hit.link, {
          timeoutMs: HTML_FETCH_TIMEOUT_MS,
        });
        if (!page) continue;
        const urls = extractListingImageUrls(page.html, hit.link);
        const picked = dedupeAgainst(
          urls,
          MAX_WEBSITE_INTERIOR_URLS,
          interiorKeys,
        );
        if (picked.length > 0) {
          interiorUrls = picked;
          usedSerperWebHtmlInteriors = true;
          trace.push(
            `Serper web "${qPhotos}": used ${hit.link} → ${picked.length} image URL(s)`,
          );
          break;
        }
      }
      if (interiorUrls.length === 0) {
        trace.push(
          `Serper web "${qPhotos}": tried top organic hits; no extractable interior images`,
        );
      }
    } catch (e) {
      trace.push(`Serper web: ${(e as Error).message}`);
    }
  }

  const sourceParts: string[] = [];
  if (usedWebsiteInteriors) sourceParts.push("candidate website (interiors)");
  if (usedSerperInteriorSearch)
    sourceParts.push('Google Images — "…interior apartment photos"');
  if (usedSerperExteriorSearch)
    sourceParts.push('Google Images — "…exterior building"');
  if (usedSerperWebHtmlInteriors) sourceParts.push("Serper web HTML (interiors)");
  const referencePhotoSource =
    sourceParts.length > 0 ? sourceParts.join(" + ") : "unknown";

  const interiorKeySet = new Set(interiorUrls.map(normalizeImageUrlKey));
  exteriorUrls = exteriorUrls.filter(
    (u) => !interiorKeySet.has(normalizeImageUrlKey(u)),
  );

  /** At most 3 listing reference photos total per verification call. */
  interiorUrls = interiorUrls.slice(0, 3);
  exteriorUrls = exteriorUrls.slice(
    0,
    Math.max(0, 3 - interiorUrls.length),
  );

  return {
    interiorUrls,
    exteriorUrls,
    trace,
    referencePhotoSource,
    usedWebsiteInteriors,
    usedSerperInteriorSearch,
    usedSerperExteriorSearch,
  };
}

interface VerifyArgs {
  match: ApartmentMatch;
  /** Combined evidence: TikTok thumbnail + extracted video frames + user screenshots. */
  sourceFrames: string[];
  request: AnalyzeRequest;
}

/**
 * Run visual verification for a single candidate. Never throws — every
 * failure mode returns an UNVERIFIED verdict with `listingPhotoTrace` set.
 */
export async function verifyCandidate(
  args: VerifyArgs,
): Promise<VisualVerification> {
  const { match, sourceFrames: rawFrames, request } = args;
  const original = match.confidence;
  const sourceFrames = rawFrames.slice(0, MAX_SOURCE_FRAMES);
  const city = request.city.trim();

  if (sourceFrames.length === 0) {
    return unverified(
      original,
      "No video frames or screenshots available — cannot compare.",
    );
  }

  // ---- Mock fast-path ---------------------------------------------------
  if (mockEnabled()) {
    const canned =
      MOCK_VISUAL_VERIFICATIONS[match.name] ??
      MOCK_VISUAL_VERIFICATIONS.default;
    const bucket = normalizeConfidencePenaltyBucket(
      canned.status as Exclude<VisualVerificationStatus, "UNVERIFIED">,
      canned.confidencePenaltyBucket,
    );
    return {
      ...canned,
      confidencePenaltyBucket: bucket,
      originalConfidence: original,
      adjustedConfidence: adjustConfidence(original, canned.status, bucket),
    };
  }

  const {
    interiorUrls,
    exteriorUrls,
    trace,
    referencePhotoSource,
  } = await resolveVerificationReferenceImages(match, city);

  if (interiorUrls.length === 0 && exteriorUrls.length === 0) {
    return unverified(
      original,
      "Could not obtain any reference image URLs (website, Serper Images, and Serper web fallbacks all failed or returned nothing).",
      trace,
    );
  }

  type RefKind = "interior" | "exterior";
  const refPlan: { url: string; kind: RefKind }[] = [
    ...interiorUrls.map((url) => ({ url, kind: "interior" as const })),
    ...exteriorUrls.map((url) => ({ url, kind: "exterior" as const })),
  ];

  const photoResults = await Promise.allSettled(
    refPlan.map((r) =>
      fetchImageAsDataUrl(r.url, { timeoutMs: PHOTO_FETCH_TIMEOUT_MS }),
    ),
  );
  const interiorPhotos: { url: string; data: string }[] = [];
  const exteriorPhotos: { url: string; data: string }[] = [];
  for (let i = 0; i < photoResults.length; i++) {
    const r = photoResults[i];
    const plan = refPlan[i]!;
    if (r.status === "fulfilled" && r.value) {
      const item = { url: plan.url, data: r.value };
      if (plan.kind === "interior") interiorPhotos.push(item);
      else exteriorPhotos.push(item);
    }
  }

  if (interiorPhotos.length === 0 && exteriorPhotos.length === 0) {
    trace.push(
      "All reference image downloads failed (hosts may block server fetches).",
    );
    return unverified(
      original,
      "Found reference image URLs but could not download any bytes for the vision model.",
      trace,
    );
  }

  const visionModel =
    process.env.OPENROUTER_VISION_MODEL ?? "google/gemini-2.5-flash";

  const userText = buildVisualVerificationUserPrompt({
    match,
    request,
    videoFrameCount: sourceFrames.length,
    interiorPhotoCount: interiorPhotos.length,
    exteriorPhotoCount: exteriorPhotos.length,
    referencePhotoSource,
  });

  type ContentPart =
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } };

  const userContent: ContentPart[] = [
    { type: "text", text: userText },
    { type: "text", text: "--- TIKTOK VIDEO FRAMES ---" },
    ...sourceFrames.map(
      (url): ContentPart => ({ type: "image_url", image_url: { url } }),
    ),
    { type: "text", text: "--- INTERIOR REFERENCE PHOTOS ---" },
    ...interiorPhotos.map(
      (p): ContentPart => ({
        type: "image_url",
        image_url: { url: p.data },
      }),
    ),
    { type: "text", text: "--- EXTERIOR / BUILDING REFERENCE PHOTOS ---" },
    ...exteriorPhotos.map(
      (p): ContentPart => ({
        type: "image_url",
        image_url: { url: p.data },
      }),
    ),
  ];

  let parsed: {
    rating: VisualVerificationStatus | string;
    confidence_penalty_bucket?: string;
    confidencePenaltyBucket?: string;
    matched_features?: string[];
    mismatched_features?: string[];
    reasoning?: string;
    explanation?: string;
  };
  try {
    const { text, modelUsed, attemptsLog } = await callOpenRouter({
      model: visionModel,
      messages: [
        { role: "system", content: VISUAL_VERIFICATION_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      maxTokens: 800,
      jsonMode: true,
      debugLabel: `visual_verify:${candidateDisplayName(match)}`,
    });
    trace.push(
      `OpenRouter: ${modelUsed}` +
        (attemptsLog.length ? ` — ${attemptsLog.join("; ")}` : ""),
    );
    parsed = extractJson(text);
  } catch (err) {
    const msg =
      err instanceof OpenRouterError
        ? `${err.message}${err.body ? ` — ${err.body}` : ""}`
        : (err as Error).message;
    trace.push(`Vision model error: ${msg}`);
    return unverified(original, `Vision model call failed: ${msg}`, trace);
  }

  const rating = normalizeRating(parsed.rating);
  if (!rating) {
    trace.push(`Unrecognized rating: ${String(parsed.rating)}`);
    return unverified(
      original,
      `Vision model returned an unrecognized rating: ${String(parsed.rating)}`,
      trace,
    );
  }

  const bucketRaw =
    parsed.confidence_penalty_bucket ?? parsed.confidencePenaltyBucket;
  const bucket = normalizeConfidencePenaltyBucket(rating, bucketRaw);

  return {
    status: rating,
    confidencePenaltyBucket: bucket,
    reasoning: parsed.reasoning ?? parsed.explanation ?? "",
    matchedFeatures: parsed.matched_features ?? [],
    mismatchedFeatures: parsed.mismatched_features ?? [],
    candidatePhotos: [...interiorPhotos, ...exteriorPhotos].map((p) => p.url),
    listingPhotoTrace: trace,
    originalConfidence: original,
    adjustedConfidence: adjustConfidence(original, rating, bucket),
  };
}

function normalizeRating(
  raw: unknown,
): Exclude<VisualVerificationStatus, "UNVERIFIED"> | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (t === "STRONG_MATCH" || t === "STRONG") return "STRONG_MATCH";
  if (t === "PARTIAL_MATCH" || t === "PARTIAL") return "PARTIAL_MATCH";
  if (t === "NO_MATCH" || t === "NO" || t === "NONE" || t === "MISMATCH")
    return "NO_MATCH";
  return null;
}
