import { NextRequest, NextResponse } from "next/server";
import { fetchPagesRespectingHost403 } from "@/lib/fetch-page";
import {
  callOpenRouter,
  extractJson,
  mockEnabled,
  MOCK_CANDIDATE_ANALYSIS,
  MOCK_CLUE_EXTRACTION,
  MOCK_FETCHED_PAGES,
  OpenRouterError,
} from "@/lib/openrouter";
import {
  CANDIDATE_ANALYSIS_SYSTEM_PROMPT,
  CLUE_EXTRACTION_SYSTEM_PROMPT,
  buildCandidateAnalysisUserPrompt,
  buildClueExtractionUserPrompt,
} from "@/lib/prompts";
import {
  buildMockSpatialLandmarkCandidates,
  collectApartmentsNearLandmarks,
} from "@/lib/places";
import {
  buildAnalyzeFetchUrlList,
  buildMockSearchResults,
  runSearches,
} from "@/lib/search";
import { extractVideoMetadata } from "@/lib/tiktok";
import {
  MAX_VISION_FRAMES,
  createThumbnailDataUrl,
  extractFramesFromUrl,
  fetchThumbnailAsDataUrl,
  saveVisionFramesToDebugDirectory,
} from "@/lib/video-frames";
import { verifyCandidate } from "@/lib/visual-verification";
import {
  appendScan,
  finalizeScanAccess,
  precheckScanAccess,
} from "@/lib/visitor-db";
import type {
  AnalyzeErrorResponse,
  AnalyzeRequest,
  AnalyzeResponse,
  CandidateAnalysis,
  ClueExtraction,
  ClueExtractionVisionDebug,
  ClueVisionImageSource,
  FetchedPage,
  SpatialLandmarkCandidate,
  VideoMetadata,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Pipeline includes staggered AI calls + OpenRouter 429 backoff; allow headroom. */
export const maxDuration = 120;

const MAX_SCREENSHOTS = 3;
/** After 2 fps extract + even subsampling, at most this many video frames go to clue extraction (full scan). */
const MAX_FRAMES_FROM_VIDEO = MAX_VISION_FRAMES;
/** Free scan: fewer frames, same Gemini + DeepSeek pipeline (no Places, no visual verification). */
const LITE_MAX_VISION_FRAMES = 5;
const MAX_SEARCH_QUERIES_FULL = 7;
const LITE_MAX_SERPER_QUERIES = 4;
/** Primary top-N fetches plus listicle/locator bonus URLs; see `buildAnalyzeFetchUrlList`. */
const MAX_PAGES_TO_FETCH = 8;
/** Free / lite scan: cap listing page fetches to reduce cost (full scan uses {@link MAX_PAGES_TO_FETCH}). */
const LITE_MAX_PAGES_TO_FETCH = 3;
/** Max ranked URLs to consider when filling `MAX_PAGES_TO_FETCH` slots (403 skips burn candidates). */
const MAX_FETCH_URL_CANDIDATES = 50;
const MAX_CANDIDATES_TO_VERIFY = 3;

/** Max width for clue-extraction debug thumbnails (full-res still goes to the model). */
const CLUE_VISION_THUMB_MAX_W = 220;

const DEEPSEEK_TEXT_MODEL =
  process.env.OPENROUTER_TEXT_MODEL ?? "deepseek/deepseek-chat";

function badRequest(message: string, details?: string) {
  const body: AnalyzeErrorResponse = { ok: false, error: message, details };
  return NextResponse.json(body, { status: 400 });
}

function isDataUrlImage(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const t = s.trim();
  // Case-insensitive MIME; allow whitespace after "base64," (some clients vary).
  return /^data:image\/(jpeg|jpg|png|webp);base64,\s*\S+/i.test(t);
}

function validateRequest(body: unknown): AnalyzeRequest | { error: string } {
  if (!body || typeof body !== "object") return { error: "Body must be a JSON object." };
  const b = body as Record<string, unknown>;

  if (typeof b.city !== "string" || b.city.trim().length === 0) {
    return { error: "`city` is required." };
  }
  if (b.priceRange !== undefined && typeof b.priceRange !== "string") {
    return { error: "`priceRange` must be a string when provided." };
  }
  if (b.additionalContext !== undefined && typeof b.additionalContext !== "string") {
    return { error: "`additionalContext` must be a string when provided." };
  }
  if (b.visitorId !== undefined && typeof b.visitorId !== "string") {
    return { error: "`visitorId` must be a string when provided." };
  }
  if (b.fullScan !== undefined && typeof b.fullScan !== "boolean") {
    return { error: "`fullScan` must be a boolean when provided." };
  }
  if (b.tiktokUrl !== undefined && typeof b.tiktokUrl !== "string") {
    return { error: "`tiktokUrl` must be a string when provided." };
  }

  let screenshots: string[] | undefined;
  if (b.screenshots !== undefined) {
    if (!Array.isArray(b.screenshots)) {
      return { error: "`screenshots` must be an array of data URLs." };
    }
    if (!b.screenshots.every(isDataUrlImage)) {
      return {
        error:
          "Every screenshot must be a base64 data URL (data:image/jpeg;base64,...).",
      };
    }
    if (b.screenshots.length > MAX_SCREENSHOTS) {
      return { error: `At most ${MAX_SCREENSHOTS} screenshots allowed.` };
    }
    screenshots = b.screenshots as string[];
  }

  const tiktokUrl = (b.tiktokUrl as string | undefined)?.trim();
  if (!tiktokUrl) {
    return { error: "`tiktokUrl` is required." };
  }

  return {
    city: b.city.trim(),
    priceRange: (b.priceRange as string | undefined)?.trim() || undefined,
    additionalContext:
      (b.additionalContext as string | undefined)?.trim() || undefined,
    tiktokUrl,
    screenshots,
    visitorId: (b.visitorId as string | undefined)?.trim() || undefined,
    fullScan: b.fullScan === true,
  };
}

/** Slots assembled in clue-extraction order before capping. */
type ClueVisionSlot =
  | { kind: "oembed_thumbnail"; url: string }
  | { kind: "video_frame"; url: string; frameIndex: number }
  | { kind: "user_screenshot"; url: string; screenshotIndex: number };

async function buildClueExtractionVisionDebug(
  slots: ClueVisionSlot[],
  clueExtractionUsedLiveVision: boolean,
  stats: {
    videoFramesRawExtracted: number | null;
    videoFramesAfterSubsampling: number | null;
    visionDebugFramesDir: string | null;
    visionDebugSavedFiles: string[] | null;
  },
): Promise<ClueExtractionVisionDebug> {
  const counts: Record<ClueVisionImageSource, number> = {
    oembed_thumbnail: 0,
    video_frame: 0,
    user_screenshot: 0,
  };
  for (const s of slots) counts[s.kind]++;

  const images = await Promise.all(
    slots.map(async (s, index) => {
      let thumbnailDataUrl: string | undefined;
      try {
        thumbnailDataUrl = await createThumbnailDataUrl(
          s.url,
          CLUE_VISION_THUMB_MAX_W,
        );
      } catch {
        thumbnailDataUrl = undefined;
      }
      return {
        index,
        source: s.kind,
        dataUrlChars: s.url.length,
        label:
          s.kind === "oembed_thumbnail"
            ? "oEmbed thumbnail"
            : s.kind === "video_frame"
              ? `Video frame #${s.frameIndex + 1}`
              : `User screenshot #${s.screenshotIndex + 1}`,
        thumbnailDataUrl,
      };
    }),
  );

  return {
    totalImagesSent: slots.length,
    clueExtractionUsedLiveVision,
    countsBySource: counts,
    images,
    videoFramesRawFromFfmpeg: stats.videoFramesRawExtracted,
    videoFramesAfterSubsampling: stats.videoFramesAfterSubsampling,
    visionDebugFramesDirectory: stats.visionDebugFramesDir,
    visionDebugSavedFilenames: stats.visionDebugSavedFiles,
  };
}

function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

// Deep-clone JSON-safe data. We hand fresh copies of the mock objects to each
// request so downstream mutations (Step 5 adjusts confidence in place) don't
// leak across requests in dev mode.
function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

const AI_CALL_SPACING_MS = 2000;

function delayAiSpacing(): Promise<void> {
  return new Promise((r) => setTimeout(r, AI_CALL_SPACING_MS));
}

async function runClueExtraction(args: {
  request: AnalyzeRequest;
  metadata: VideoMetadata | null;
  imageDataUrls: string[];
  openRouterLog: string[];
}): Promise<ClueExtraction> {
  if (mockEnabled()) return cloneJson(MOCK_CLUE_EXTRACTION);

  const visionModel =
    process.env.OPENROUTER_VISION_MODEL ?? "google/gemini-2.5-flash";

  const userText = buildClueExtractionUserPrompt({
    request: args.request,
    metadata: args.metadata,
  });

  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [{ type: "text", text: userText }];
  for (const url of args.imageDataUrls) {
    userContent.push({ type: "image_url", image_url: { url } });
  }

  const { text, modelUsed, attemptsLog } = await callOpenRouter({
    model: visionModel,
    messages: [
      { role: "system", content: CLUE_EXTRACTION_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    maxTokens: 1500,
    jsonMode: true,
    debugLabel: "clue_extraction",
  });

  args.openRouterLog.push(
    `clue_extraction → ${modelUsed}` +
      (attemptsLog.length ? ` — ${attemptsLog.join("; ")}` : ""),
  );

  return extractJson<ClueExtraction>(text);
}

async function runCandidateAnalysis(args: {
  request: AnalyzeRequest;
  clues: ClueExtraction;
  searchResults: ReturnType<typeof buildMockSearchResults>;
  fetchedPages: FetchedPage[];
  metadata: VideoMetadata | null;
  spatialLandmarkCandidates: SpatialLandmarkCandidate[];
  openRouterLog: string[];
}): Promise<CandidateAnalysis> {
  if (mockEnabled()) return cloneJson(MOCK_CANDIDATE_ANALYSIS);

  const reasoningModel = DEEPSEEK_TEXT_MODEL;

  const userText = buildCandidateAnalysisUserPrompt({
    clues: args.clues,
    searchResults: args.searchResults,
    fetchedPages: args.fetchedPages,
    request: args.request,
    metadata: args.metadata,
    spatialLandmarkCandidates: args.spatialLandmarkCandidates,
  });

  const { text, modelUsed, attemptsLog } = await callOpenRouter({
    model: reasoningModel,
    messages: [
      { role: "system", content: CANDIDATE_ANALYSIS_SYSTEM_PROMPT },
      { role: "user", content: userText },
    ],
    maxTokens: 4000,
    jsonMode: true,
    debugLabel: "candidate_analysis",
  });

  args.openRouterLog.push(
    `candidate_analysis → ${modelUsed}` +
      (attemptsLog.length ? ` — ${attemptsLog.join("; ")}` : ""),
  );

  return extractJson<CandidateAnalysis>(text);
}

/**
 * oEmbed + ffmpeg frames (+ optional user screenshots), capped for vision cost.
 * `videoDerivedCount` = thumbnail + video frames only (excludes user screenshots).
 */
async function gatherVisionInputs(
  request: AnalyzeRequest,
  maxVisionFrames: number,
  warnings: string[],
  timings: Record<string, number>,
): Promise<
  | { ok: false; response: NextResponse }
  | {
      ok: true;
      videoMetadata: VideoMetadata | null;
      cappedSlots: ClueVisionSlot[];
      imageDataUrls: string[];
      videoFramesRawExtracted: number | null;
      videoFramesAfterSubsampling: number | null;
      visionDebugFramesDir: string | null;
      visionDebugSavedFiles: string[] | null;
      videoDerivedCount: number;
    }
> {
  let videoMetadata: VideoMetadata | null = null;
  const visionSlots: ClueVisionSlot[] = [];
  let videoFramesRawExtracted: number | null = null;
  let videoFramesAfterSubsampling: number | null = null;
  let visionDebugFramesDir: string | null = null;
  let visionDebugSavedFiles: string[] | null = null;
  let videoDerivedCount = 0;

  if (request.tiktokUrl) {
    const tStart = Date.now();
    videoMetadata = await extractVideoMetadata(request.tiktokUrl);
    timings.tiktok_extract_ms = Date.now() - tStart;
    if (videoMetadata.extractionError) {
      warnings.push(`Link extraction: ${videoMetadata.extractionError}`);
    }

    if (videoMetadata.thumbnailUrl) {
      const thumb = await fetchThumbnailAsDataUrl(videoMetadata.thumbnailUrl);
      if (thumb) {
        visionSlots.push({ kind: "oembed_thumbnail", url: thumb });
      } else {
        warnings.push(
          `Could not fetch oEmbed thumbnail at ${videoMetadata.thumbnailUrl}.`,
        );
      }
    }

    const tFrames = Date.now();
    if (mockEnabled()) {
      videoFramesRawExtracted = maxVisionFrames;
      videoFramesAfterSubsampling = maxVisionFrames;
      for (let i = 0; i < maxVisionFrames; i++) {
        visionSlots.push({
          kind: "video_frame",
          url: "data:image/jpeg;base64,/9j/2wBDAA==",
          frameIndex: i,
        });
      }
      timings.video_frames_ms = Date.now() - tFrames;
    } else if (videoMetadata.videoUrl) {
      try {
        const result = await extractFramesFromUrl(videoMetadata.videoUrl, {
          strategy: "every_half_second",
          durationSec: videoMetadata.durationSec ?? null,
          maxVisionFrames,
        });
        videoFramesRawExtracted = result.rawExtractedFrameCount ?? null;
        videoFramesAfterSubsampling = result.frames.length;
        try {
          const saved = await saveVisionFramesToDebugDirectory(result.frames);
          visionDebugFramesDir = saved.dir;
          visionDebugSavedFiles = saved.filenames;
        } catch (saveErr) {
          warnings.push(
            `Debug frame save failed: ${(saveErr as Error).message}`,
          );
        }
        let fi = 0;
        for (const frame of result.frames) {
          visionSlots.push({
            kind: "video_frame",
            url: frame,
            frameIndex: fi++,
          });
        }
        timings.video_frames_ms = Date.now() - tFrames;
      } catch (err) {
        timings.video_frames_ms = Date.now() - tFrames;
        warnings.push(
          `Video frame extraction failed: ${(err as Error).message}`,
        );
      }
    } else {
      timings.video_frames_ms = 0;
      warnings.push(
        "No downloadable video URL available (tikwm may be down or rate-limited). Falling back to thumbnail/screenshots.",
      );
    }

    videoDerivedCount = visionSlots.length;

    if (
      videoDerivedCount === 0 &&
      (request.screenshots?.length ?? 0) === 0
    ) {
      const haveOembedText =
        !!videoMetadata.caption || videoMetadata.hashtags.length > 0;
      const body: AnalyzeErrorResponse = {
        ok: false,
        error: haveOembedText
          ? "We got the caption but couldn't download the video for frame-by-frame analysis. Try again later or retry the link."
          : "We couldn't access enough from this URL for a full scan.",
        details: warnings.join(" | ") || undefined,
      };
      return {
        ok: false,
        response: NextResponse.json(body, { status: 422 }),
      };
    }
  }

  let screenshotIndex = 0;
  for (const url of request.screenshots ?? []) {
    visionSlots.push({
      kind: "user_screenshot",
      url,
      screenshotIndex: screenshotIndex++,
    });
  }

  const cap = MAX_SCREENSHOTS + maxVisionFrames + 1;
  const cappedSlots = visionSlots.slice(0, cap);
  const imageDataUrls = cappedSlots.map((s) => s.url);

  return {
    ok: true,
    videoMetadata,
    cappedSlots,
    imageDataUrls,
    videoFramesRawExtracted,
    videoFramesAfterSubsampling,
    visionDebugFramesDir,
    visionDebugSavedFiles,
    videoDerivedCount,
  };
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const warnings: string[] = [];
  const openRouterLog: string[] = [];
  const timings: Record<string, number> = {};

  const ip = getClientIp(req);
  /** Local/testing: full pipeline without consuming credits (remove before production). */
  const devBypass = req.nextUrl.searchParams.get("dev") === "true";

  let json: unknown;
  try {
    json = await req.json();
  } catch (e) {
    return badRequest("Body is not valid JSON.", (e as Error).message);
  }

  const validated = validateRequest(json);
  if ("error" in validated) return badRequest(validated.error);
  const request = validated;

  let runFull = false;
  if (devBypass) {
    runFull = true;
  } else {
    const access = await precheckScanAccess(request.visitorId, ip);
    if (!access.ok) {
      const status = access.code === "IP_RATE_LIMIT" ? 429 : 403;
      const body: AnalyzeErrorResponse = {
        ok: false,
        error: access.message,
        code: access.code === "NO_CREDITS" ? "no_credits" : access.code,
      };
      return NextResponse.json(body, { status });
    }
    runFull = access.tier === "full";
  }

  async function persistScanRow(
    tier: "lite" | "full",
    analysis: CandidateAnalysis,
    visitorId: string,
  ) {
    const top = analysis.matches?.[0];
    try {
      await appendScan({
        fingerprint: visitorId.trim(),
        tiktok_url: request.tiktokUrl!,
        city: request.city,
        scan_tier: tier,
        top_match: top?.name ?? "",
        confidence: top?.confidence ?? 0,
      });
    } catch {
      /* non-fatal */
    }
  }

  // ---- Lite scan (free): video download + up to 5 frames, Gemini clues,
  // DeepSeek candidates, Serper (4 queries) + page fetch, no Places, no visual verification.
  if (!runFull) {
    const tLite0 = Date.now();

    const gv = await gatherVisionInputs(
      request,
      LITE_MAX_VISION_FRAMES,
      warnings,
      timings,
    );
    if (!gv.ok) return gv.response;

    const {
      videoMetadata: vm,
      cappedSlots,
      imageDataUrls,
      videoFramesRawExtracted: vfRaw,
      videoFramesAfterSubsampling: vfSub,
      visionDebugFramesDir: vDir,
      visionDebugSavedFiles: vFiles,
      videoDerivedCount: vdCount,
    } = gv;

    const clueExtractionVision = await buildClueExtractionVisionDebug(
      cappedSlots,
      !mockEnabled(),
      {
        videoFramesRawExtracted: vfRaw,
        videoFramesAfterSubsampling: vfSub,
        visionDebugFramesDir: vDir,
        visionDebugSavedFiles: vFiles,
      },
    );

    console.info("[analyze] lite clue-extraction vision inputs", {
      total: clueExtractionVision.totalImagesSent,
      counts: clueExtractionVision.countsBySource,
      liveVisionCall: clueExtractionVision.clueExtractionUsedLiveVision,
      videoFramesRawFromFfmpeg: clueExtractionVision.videoFramesRawFromFfmpeg,
      videoFramesAfterSubsampling:
        clueExtractionVision.videoFramesAfterSubsampling,
      debugFramesDir: clueExtractionVision.visionDebugFramesDirectory,
    });

    if (imageDataUrls.length === 0) {
      warnings.push(
        "No images available to the vision model. Clue extraction will rely on caption/hashtags only.",
      );
    }

    let clues: ClueExtraction;
    try {
      const tClue = Date.now();
      clues = await runClueExtraction({
        request,
        metadata: vm,
        imageDataUrls,
        openRouterLog,
      });
      timings.clue_extraction_ms = Date.now() - tClue;
    } catch (err) {
      return NextResponse.json(
        {
          ok: false,
          error: "Clue extraction failed.",
          details:
            err instanceof OpenRouterError
              ? `${err.message}${err.body ? ` — ${err.body}` : ""}`
              : (err as Error).message,
        } satisfies AnalyzeErrorResponse,
        { status: 502 },
      );
    }

    if (!mockEnabled()) {
      await delayAiSpacing();
    }

    timings.places_ms = 0;
    const spatialLandmarkCandidates: SpatialLandmarkCandidate[] = [];

    const liteQueries = (clues.search_queries ?? []).slice(
      0,
      LITE_MAX_SERPER_QUERIES,
    );
    let searchResults: Awaited<ReturnType<typeof runSearches>>;
    try {
      const tSearch = Date.now();
      if (mockEnabled()) {
        searchResults = buildMockSearchResults(liteQueries);
      } else {
        searchResults = await runSearches(
          liteQueries,
          LITE_MAX_SERPER_QUERIES,
        );
      }
      timings.search_ms = Date.now() - tSearch;
    } catch (err) {
      warnings.push(`Search failed: ${(err as Error).message}`);
      searchResults = [];
    }

    const fetchTargets = buildAnalyzeFetchUrlList(
      searchResults,
      request.city,
      {
        primaryCount: 5,
        bonusCap: 3,
        maxTotal: LITE_MAX_PAGES_TO_FETCH,
        maxCandidates: MAX_FETCH_URL_CANDIDATES,
      },
    );
    let fetchedPages: FetchedPage[] = [];
    if (fetchTargets.length > 0) {
      const tFetch = Date.now();
      if (mockEnabled()) {
        fetchedPages = cloneJson(
          MOCK_FETCHED_PAGES.slice(
            0,
            Math.min(LITE_MAX_PAGES_TO_FETCH, MOCK_FETCHED_PAGES.length),
          ),
        );
      } else {
        fetchedPages = await fetchPagesRespectingHost403(
          fetchTargets,
          LITE_MAX_PAGES_TO_FETCH,
        );
      }
      timings.fetch_pages_ms = Date.now() - tFetch;
      for (const p of fetchedPages) {
        if (p.error) {
          warnings.push(`Page fetch failed (${p.url}): ${p.error}`);
        }
      }
    } else {
      timings.fetch_pages_ms = 0;
    }

    let analysis: CandidateAnalysis;
    try {
      const tCand = Date.now();
      if (!mockEnabled()) {
        await delayAiSpacing();
      }
      analysis = await runCandidateAnalysis({
        request,
        clues,
        searchResults,
        fetchedPages,
        metadata: vm,
        spatialLandmarkCandidates,
        openRouterLog,
      });
      timings.candidate_analysis_ms = Date.now() - tCand;
    } catch (err) {
      return NextResponse.json(
        {
          ok: false,
          error: "Candidate analysis failed.",
          details:
            err instanceof OpenRouterError
              ? `${err.message}${err.body ? ` — ${err.body}` : ""}`
              : (err as Error).message,
        } satisfies AnalyzeErrorResponse,
        { status: 502 },
      );
    }

    if (Array.isArray(analysis.matches)) {
      analysis.matches.sort(
        (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0),
      );
      analysis.matches = analysis.matches.slice(0, 3);
    }

    timings.visual_verification_ms = 0;
    timings.total_ms = Date.now() - tLite0;

    const responseMetadataLite: VideoMetadata | null = vm
      ? { ...vm, frames: new Array(vdCount).fill("") }
      : null;

    const responseLite: AnalyzeResponse = {
      ok: true,
      scanTier: "lite",
      sourceTiktokUrl: request.tiktokUrl,
      city: request.city,
      videoMetadata: responseMetadataLite,
      clueExtractionVision,
      clues,
      spatialLandmarkCandidates,
      searchResults,
      fetchedPages,
      analysis,
      timings,
      warnings,
      ...(openRouterLog.length > 0 ? { openRouterLog } : {}),
    };

    if (!devBypass && request.visitorId) {
      const fin = await finalizeScanAccess(request.visitorId, ip, {
        tier: "lite",
      });
      if (!fin.ok) {
        const status = fin.code === "IP_RATE_LIMIT" ? 429 : 503;
        const body: AnalyzeErrorResponse = {
          ok: false,
          error: fin.message,
          code: fin.code === "NO_CREDITS" ? "no_credits" : fin.code,
        };
        return NextResponse.json(body, { status });
      }
    }

    if (request.visitorId) {
      await persistScanRow("lite", analysis, request.visitorId);
    }

    return NextResponse.json(responseLite, { status: 200 });
  }

  // ---- Full scan — Step 1: vision inputs (up to 10 frames + thumbnail + screenshots)
  const gvFull = await gatherVisionInputs(
    request,
    MAX_FRAMES_FROM_VIDEO,
    warnings,
    timings,
  );
  if (!gvFull.ok) return gvFull.response;

  const videoMetadata = gvFull.videoMetadata;
  const cappedSlots = gvFull.cappedSlots;
  const imageDataUrls = gvFull.imageDataUrls;
  const videoFramesRawExtracted = gvFull.videoFramesRawExtracted;
  const videoFramesAfterSubsampling = gvFull.videoFramesAfterSubsampling;
  const visionDebugFramesDir = gvFull.visionDebugFramesDir;
  const visionDebugSavedFiles = gvFull.visionDebugSavedFiles;
  const videoDerivedCount = gvFull.videoDerivedCount;

  const clueExtractionVision = await buildClueExtractionVisionDebug(
    cappedSlots,
    !mockEnabled(),
    {
      videoFramesRawExtracted,
      videoFramesAfterSubsampling,
      visionDebugFramesDir,
      visionDebugSavedFiles,
    },
  );

  console.info("[analyze] clue-extraction vision inputs", {
    total: clueExtractionVision.totalImagesSent,
    counts: clueExtractionVision.countsBySource,
    liveVisionCall: clueExtractionVision.clueExtractionUsedLiveVision,
    videoFramesRawFromFfmpeg: clueExtractionVision.videoFramesRawFromFfmpeg,
    videoFramesAfterSubsampling:
      clueExtractionVision.videoFramesAfterSubsampling,
    debugFramesDir: clueExtractionVision.visionDebugFramesDirectory,
  });

  if (imageDataUrls.length === 0) {
    warnings.push(
      "No images available to the vision model. Clue extraction will rely on caption/hashtags only.",
    );
  }

  // ---- Step 2: Clue extraction ---------------------------------------
  let clues: ClueExtraction;
  try {
    const tStart = Date.now();
    clues = await runClueExtraction({
      request,
      metadata: videoMetadata,
      imageDataUrls,
      openRouterLog,
    });
    timings.clue_extraction_ms = Date.now() - tStart;
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "Clue extraction failed.",
        details:
          err instanceof OpenRouterError
            ? `${err.message}${err.body ? ` — ${err.body}` : ""}`
            : (err as Error).message,
      } satisfies AnalyzeErrorResponse,
      { status: 502 },
    );
  }

  if (!mockEnabled()) {
    await delayAiSpacing();
  }

  // ---- Step 2.5: Places — apartments near geocoded landmarks ----------
  let spatialLandmarkCandidates: SpatialLandmarkCandidate[] = [];
  const tPlaces = Date.now();
  try {
    if (mockEnabled()) {
      spatialLandmarkCandidates = buildMockSpatialLandmarkCandidates(
        request.city,
      );
    } else if ((clues.landmarks_spotted?.length ?? 0) > 0) {
      const { candidates, warnings: placeWarnings } =
        await collectApartmentsNearLandmarks(
          clues.landmarks_spotted ?? [],
          request.city,
        );
      spatialLandmarkCandidates = candidates;
      for (const w of placeWarnings) warnings.push(w);
    }
  } catch (err) {
    warnings.push(
      `Landmark / Places step failed: ${(err as Error).message}`,
    );
  }
  timings.places_ms = Date.now() - tPlaces;

  // ---- Step 3: Web search ---------------------------------------------
  const queries = (clues.search_queries ?? []).slice(
    0,
    MAX_SEARCH_QUERIES_FULL,
  );
  let searchResults: Awaited<ReturnType<typeof runSearches>>;
  try {
    const tStart = Date.now();
    if (mockEnabled()) {
      searchResults = buildMockSearchResults(queries);
    } else {
      searchResults = await runSearches(queries, MAX_SEARCH_QUERIES_FULL);
    }
    timings.search_ms = Date.now() - tStart;
  } catch (err) {
    warnings.push(`Search failed: ${(err as Error).message}`);
    searchResults = [];
  }

  // ---- Step 3.5: Fetch top listing pages -------------------------------
  // Search snippets often hide the building name. We fetch the top 5 URLs by
  // score, then up to 3 bonus listicle/locator-pattern URLs from the rest
  // (cap 8 total). Scoring uses URL path + title/snippet patterns, not a
  // hardcoded domain list.
  const fetchTargets = buildAnalyzeFetchUrlList(
    searchResults,
    request.city,
    {
      primaryCount: 5,
      bonusCap: 3,
      maxTotal: MAX_PAGES_TO_FETCH,
      maxCandidates: MAX_FETCH_URL_CANDIDATES,
    },
  );
  let fetchedPages: FetchedPage[] = [];
  if (fetchTargets.length > 0) {
    const tStart = Date.now();
    if (mockEnabled()) {
      fetchedPages = cloneJson(
        MOCK_FETCHED_PAGES.slice(
          0,
          Math.min(MAX_PAGES_TO_FETCH, MOCK_FETCHED_PAGES.length),
        ),
      );
    } else {
      fetchedPages = await fetchPagesRespectingHost403(
        fetchTargets,
        MAX_PAGES_TO_FETCH,
      );
    }
    timings.fetch_pages_ms = Date.now() - tStart;
    for (const p of fetchedPages) {
      if (p.error) {
        warnings.push(`Page fetch failed (${p.url}): ${p.error}`);
      }
    }
  } else {
    timings.fetch_pages_ms = 0;
  }

  // ---- Step 4: Candidate analysis -------------------------------------
  let analysis: CandidateAnalysis;
  try {
    const tStart = Date.now();
    if (!mockEnabled()) {
      await delayAiSpacing();
    }
    analysis = await runCandidateAnalysis({
      request,
      clues,
      searchResults,
      fetchedPages,
      metadata: videoMetadata,
      spatialLandmarkCandidates,
      openRouterLog,
    });
    timings.candidate_analysis_ms = Date.now() - tStart;
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "Candidate analysis failed.",
        details:
          err instanceof OpenRouterError
            ? `${err.message}${err.body ? ` — ${err.body}` : ""}`
            : (err as Error).message,
      } satisfies AnalyzeErrorResponse,
      { status: 502 },
    );
  }

  if (Array.isArray(analysis.matches)) {
    analysis.matches.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    analysis.matches = analysis.matches.slice(0, 3);
  }

  // ---- Step 5: Visual verification (sequential cost control) ------------
  // Verify #1 first; stop early on STRONG_MATCH. On NO_MATCH only, continue
  // to #2 then #3. PARTIAL_MATCH stops the chain.
  const verificationSourceFrames = imageDataUrls;
  if (
    Array.isArray(analysis.matches) &&
    analysis.matches.length > 0 &&
    verificationSourceFrames.length > 0
  ) {
    const tStart = Date.now();
    if (!mockEnabled()) {
      await delayAiSpacing();
    }
    const rankSlots = analysis.matches.slice(0, MAX_CANDIDATES_TO_VERIFY);
    for (let i = 0; i < rankSlots.length; i++) {
      const m = rankSlots[i]!;
      const v = await verifyCandidate({
        match: m,
        sourceFrames: verificationSourceFrames,
        request,
      });
      m.visual_verification = v;
      m.confidence = v.adjustedConfidence;
      if (v.status === "UNVERIFIED" && v.skipReason) {
        warnings.push(`Verification UNVERIFIED (${m.name}): ${v.skipReason}`);
      }
      if (v.status === "STRONG_MATCH") break;
      if (v.status !== "NO_MATCH") break;
    }
    analysis.matches.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    timings.visual_verification_ms = Date.now() - tStart;
  } else if (verificationSourceFrames.length === 0) {
    warnings.push(
      "Visual verification skipped: no video frames or screenshots available to compare against.",
    );
    timings.visual_verification_ms = 0;
  } else {
    timings.visual_verification_ms = 0;
  }

  timings.total_ms = Date.now() - t0;

  // Strip raw base64 frames out of the response — only surface the count so
  // the frontend can show "we extracted N frames" without dragging ~1MB of
  // JPEG bytes through the wire on every request.
  const responseMetadata: VideoMetadata | null = videoMetadata
    ? { ...videoMetadata, frames: new Array(videoDerivedCount).fill("") }
    : null;

  const response: AnalyzeResponse = {
    ok: true,
    scanTier: "full",
    sourceTiktokUrl: request.tiktokUrl,
    city: request.city,
    videoMetadata: responseMetadata,
    clueExtractionVision,
    clues,
    spatialLandmarkCandidates,
    searchResults,
    fetchedPages,
    analysis,
    timings,
    warnings,
    ...(openRouterLog.length > 0 ? { openRouterLog } : {}),
  };

  if (!devBypass && request.visitorId) {
    const fin = await finalizeScanAccess(request.visitorId, ip, {
      tier: "full",
    });
    if (!fin.ok) {
      const status = fin.code === "IP_RATE_LIMIT" ? 429 : 503;
      const body: AnalyzeErrorResponse = {
        ok: false,
        error: fin.message,
        code: fin.code === "NO_CREDITS" ? "no_credits" : fin.code,
      };
      return NextResponse.json(body, { status });
    }
  }

  if (request.visitorId) {
    await persistScanRow("full", analysis, request.visitorId);
  }

  return NextResponse.json(response, { status: 200 });
}

export function GET() {
  return NextResponse.json(
    {
      ok: true,
      message:
        "POST JSON: { city, tiktokUrl (required), additionalContext?, visitorId?, screenshots?, priceRange? }. Scan tier (lite vs full) is chosen from credits server-side. Use ?dev=true to bypass limits for testing.",
    },
    { status: 200 },
  );
}
