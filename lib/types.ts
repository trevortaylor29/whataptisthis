export type PriceRange =
  | "1000-1500"
  | "1500-2000"
  | "2000-2500"
  | "2500-3000"
  | "3000+"
  | string;

export interface AnalyzeRequest {
  city: string;
  priceRange?: PriceRange;
  additionalContext?: string;
  tiktokUrl?: string;
  /** Each screenshot is a data URL, e.g. "data:image/jpeg;base64,...". */
  screenshots?: string[];
  /** Client-side FingerprintJS visitor id for free-tier limits (server-enforced). */
  visitorId?: string;
  /**
   * When true, runs the full-cost pipeline (video frames, vision clues, page fetch,
   * Places, selective visual verification). When false/omitted, runs lite scan.
   */
  fullScan?: boolean;
}

export interface VideoMetadata {
  caption: string | null;
  hashtags: string[];
  creator: string | null;
  thumbnailUrl: string | null;
  /** Direct URL to the no-watermark MP4, when a downloader (tikwm) returned one. */
  videoUrl?: string | null;
  /** Approximate video duration in seconds, when known. */
  durationSec?: number | null;
  /** Data URLs of frames extracted from the video, when available. */
  frames: string[];
  source: "tiktok" | "instagram" | "unknown";
  /** Numeric video ID parsed from the URL, when available. */
  videoId?: string | null;
  /** ISO 8601 timestamp of when the video was posted. Decoded from the
   * Snowflake-style TikTok video ID — first 32 bits = unix seconds. */
  creationDate?: string | null;
  /** Convenience for prompts/UI: months between creationDate and now. */
  ageMonths?: number | null;
  /** Set when extraction was attempted but failed; surface to the user. */
  extractionError?: string;
}

/**
 * Outcome of attempting to grab visual data from a TikTok URL. The route
 * orchestrates this into a single combined frame set used downstream.
 */
export interface VideoFrameExtractionResult {
  /** First entry is the oEmbed thumbnail (when available); the rest are
   * video frames (typically 2 fps, subsampled to max 20) from the MP4. */
  frames: string[];
  /** Where the visual data came from. */
  source:
    | "video+thumbnail" // tikwm download → ffmpeg frames AND oEmbed thumbnail
    | "video" //         tikwm download → ffmpeg frames only
    | "thumbnail" //     oEmbed thumbnail only (downloader failed)
    | "none"; //         nothing usable was fetched
  warnings: string[];
}

export interface ClueExtraction {
  onscreen_text_overlays: string[];
  other_visible_text: string[];
  landmarks_spotted: string[];
  view_direction: string;
  apartment_tier: "luxury" | "mid-range" | "budget" | string;
  notable_features: string[];
  estimated_floor: string;
  neighborhood_clues: string[];
  price_clues: string;
  search_queries: string[];
}

export interface SearchHit {
  title: string;
  link: string;
  snippet: string;
  source?: string;
}

export interface QuerySearchResult {
  query: string;
  hits: SearchHit[];
}

/**
 * An apartment (or residential) POI within ~500m of a geocoded landmark,
 * from Serper Places. Fed into candidate analysis as high-priority hypotheses.
 */
export interface SpatialLandmarkCandidate {
  landmarkSource: string;
  /** Full Serper query used to geocode the landmark. */
  landmarkQuery: string;
  landmarkLat: number;
  landmarkLng: number;
  /** Best title returned for the landmark search. */
  landmarkResolvedTitle: string;
  apartmentName: string;
  distanceMeters: number;
  apartmentAddress?: string;
  apartmentWebsite?: string;
  placeTypes?: string[];
}

export interface FetchedPage {
  url: string;
  title: string | null;
  /** Plain-text content extracted from the page (HTML stripped). Capped. */
  content: string;
  /** Approximate length of the original HTML body in bytes. */
  htmlBytes: number;
  fetchedAt: string;
  /** Set when the fetch failed; content will be empty. */
  error?: string;
}

/**
 * Visual-verification rating tokens. UPPER_SNAKE matches the public schema
 * we ask the vision model to emit and the labels surfaced to the frontend.
 * `UNVERIFIED` covers any case where verification couldn't run (no website,
 * fetch failed, no extractable photos, no source frames, model error, etc.).
 */
export type VisualVerificationStatus =
  | "STRONG_MATCH"
  | "PARTIAL_MATCH"
  | "NO_MATCH"
  | "UNVERIFIED";

/**
 * How much to ding search-only confidence after visual verification.
 * Set by the vision model (with sane defaults if omitted).
 */
export type ConfidencePenaltyBucket =
  | "none"
  | "interior_finishes"
  | "full_building";

export interface VisualVerification {
  status: VisualVerificationStatus;
  /**
   * Penalty tier from the vision model. `full_building` → −25 with NO_MATCH;
   * `interior_finishes` → −10 for NO_MATCH or PARTIAL_MATCH; `none` otherwise.
   */
  confidencePenaltyBucket?: ConfidencePenaltyBucket;
  /** Populated when status === "UNVERIFIED". */
  skipReason?: string;
  /** Free-text explanation from the vision model. */
  reasoning: string;
  /** Optional: specific interior elements that lined up. */
  matchedFeatures: string[];
  /** Optional: specific interior elements that clearly differed. */
  mismatchedFeatures: string[];
  /** URLs of the candidate-website photos that were sent to the vision model. */
  candidatePhotos: string[];
  /** How listing photos were resolved (website → Serper web → Serper images). */
  listingPhotoTrace?: string[];
  /** Confidence the candidate had before applying this verification. */
  originalConfidence: number;
  /** Confidence after applying the verification adjustment. */
  adjustedConfidence: number;
}

/** Provenance for images sent to the clue-extraction vision call. */
export type ClueVisionImageSource =
  | "oembed_thumbnail"
  | "video_frame"
  | "user_screenshot";

export interface ClueExtractionVisionImage {
  index: number;
  source: ClueVisionImageSource;
  /** Length of the data URL string (rough size proxy). */
  dataUrlChars: number;
  /** Human-readable label for the debug panel. */
  label: string;
  /** Downscaled JPEG data URL for the debug panel (same pixels the model sees, smaller payload). */
  thumbnailDataUrl?: string;
}

export interface ClueExtractionVisionDebug {
  totalImagesSent: number;
  /** When false, mock mode returned canned clues without calling the vision API. */
  clueExtractionUsedLiveVision: boolean;
  countsBySource: Record<ClueVisionImageSource, number>;
  images: ClueExtractionVisionImage[];
  /**
   * FFmpeg `fps=2` JPEG count before subsampling to max 10 (video only).
   * Null when no video frames or unknown.
   */
  videoFramesRawFromFfmpeg: number | null;
  /**
   * Frame count after even subsampling to the vision cap (≤10). Same as video
   * slots before global image-slot cap unless unknown.
   */
  videoFramesAfterSubsampling: number | null;
  /**
   * Temp directory on the server where numbered `frame_*.jpg` files were written
   * (frames sent to vision). Null if saving failed or mock mode.
   */
  visionDebugFramesDirectory: string | null;
  /** Filenames written under {@link visionDebugFramesDirectory}. */
  visionDebugSavedFilenames: string[] | null;
}

export interface ApartmentMatch {
  name: string;
  confidence: number;
  address: string;
  website: string;
  evidence_for: string[];
  evidence_against: string[];
  reasoning: string;
  /**
   * 2-3 short bullets: upsides of this building vs alternatives (full scan / model output).
   */
  pros?: string[];
  /**
   * 2-3 short bullets: tradeoffs or drawbacks (full scan / model output).
   */
  cons?: string[];
  /** Set by Step 5 (visual verification). Absent if the step didn't run. */
  visual_verification?: VisualVerification;
}

export interface CandidateAnalysis {
  matches: ApartmentMatch[];
  overall_confidence: "high" | "medium" | "low" | string;
  limiting_factors: string[];
}

export interface AnalyzeResponse {
  ok: true;
  /** Lite = free pipeline (fewer frames, no Places / visual verification); full = paid-quality pipeline. */
  scanTier: "lite" | "full";
  /** Submitted link (for debug / support). */
  sourceTiktokUrl?: string;
  city: string;
  videoMetadata: VideoMetadata | null;
  /** What the clue-extraction step sent to the vision model (counts + sources). */
  clueExtractionVision: ClueExtractionVisionDebug;
  clues: ClueExtraction;
  /**
   * Apartment POIs near geocoded landmarks (Serper Places). Empty when no
   * usable landmarks or Places failed.
   */
  spatialLandmarkCandidates: SpatialLandmarkCandidate[];
  searchResults: QuerySearchResult[];
  fetchedPages: FetchedPage[];
  analysis: CandidateAnalysis;
  timings: Record<string, number>;
  warnings: string[];
  /**
   * Human-readable lines for the debug panel: which OpenRouter model served
   * each step (after any 429 retry / fallback).
   */
  openRouterLog?: string[];
}

export interface AnalyzeErrorResponse {
  ok: false;
  error: string;
  details?: string;
  /** Machine-readable reason for modals (e.g. free-tier / IP limits). */
  code?: "FREE_TIER_LIMIT" | "IP_RATE_LIMIT" | "NO_CREDITS" | "no_credits";
}
