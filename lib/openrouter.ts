import type {
  CandidateAnalysis,
  ClueExtraction,
  FetchedPage,
  VisualVerification,
} from "./types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Used when the primary model is rate-limited after retry. */
export const OPENROUTER_FALLBACK_MODEL = "google/gemini-2.5-flash";

const RATE_LIMIT_RETRY_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
}

interface ChatCompletionResponse {
  id?: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason?: string;
  }>;
  error?: { message: string; code?: string | number };
}

export interface CallOptions {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Force JSON output via OpenRouter's response_format. Many models honor this. */
  jsonMode?: boolean;
  /**
   * Optional label for server logs / debug (e.g. `clue_extraction`).
   * Does not affect the HTTP request.
   */
  debugLabel?: string;
}

export interface CallOpenRouterResult {
  text: string;
  raw: ChatCompletionResponse;
  /** Model that produced `text` (may differ from `options.model` after fallback). */
  modelUsed: string;
  /** Short audit trail (429 retries, fallback). */
  attemptsLog: string[];
}

export class OpenRouterError extends Error {
  status: number;
  body?: string;
  constructor(message: string, status: number, body?: string) {
    super(message);
    this.name = "OpenRouterError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Single HTTP round-trip to OpenRouter (no retries).
 */
async function openRouterRequestOnce(
  options: CallOptions,
  model: string,
): Promise<{ text: string; raw: ChatCompletionResponse }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new OpenRouterError(
      "OPENROUTER_API_KEY is not set. Add it to .env.local or set MOCK_OPENROUTER=1.",
      500,
    );
  }

  const body: Record<string, unknown> = {
    model,
    messages: options.messages,
    max_tokens: options.maxTokens ?? 2000,
    temperature: options.temperature ?? 0.2,
  };
  if (options.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer":
        process.env.OPENROUTER_REFERER ?? "https://apartment-decoder.local",
      "X-Title": "Apartment Decoder",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new OpenRouterError(
      `OpenRouter request failed: ${res.status} ${res.statusText}`,
      res.status,
      text.slice(0, 1000),
    );
  }

  let parsed: ChatCompletionResponse;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new OpenRouterError(
      "OpenRouter returned non-JSON body",
      500,
      text.slice(0, 500),
    );
  }
  if (parsed.error) {
    throw new OpenRouterError(parsed.error.message, 500, JSON.stringify(parsed.error));
  }

  const content = parsed.choices?.[0]?.message?.content ?? "";
  return { text: content, raw: parsed };
}

/**
 * On 429: wait 5s and retry that model once. If still failing, try
 * {@link OPENROUTER_FALLBACK_MODEL} with the same 429 behavior (unless it was
 * already the primary). Logs the winning model to the console.
 */
export async function callOpenRouter(
  options: CallOptions,
): Promise<CallOpenRouterResult> {
  const label = options.debugLabel ?? "openrouter";
  const attemptsLog: string[] = [];
  const primary = options.model;

  async function runWith429Retry(model: string): Promise<{
    text: string;
    raw: ChatCompletionResponse;
  }> {
    try {
      return await openRouterRequestOnce(options, model);
    } catch (err) {
      if (
        err instanceof OpenRouterError &&
        err.status === 429
      ) {
        attemptsLog.push(`${model}: 429 → wait ${RATE_LIMIT_RETRY_MS / 1000}s → retry`);
        await sleep(RATE_LIMIT_RETRY_MS);
        return await openRouterRequestOnce(options, model);
      }
      throw err;
    }
  }

  try {
    const out = await runWith429Retry(primary);
    attemptsLog.push(`${primary}: ok`);
    console.info("[openrouter] succeeded", {
      label,
      modelUsed: primary,
      attemptsLog,
    });
    return { ...out, modelUsed: primary, attemptsLog };
  } catch (primaryErr) {
    const msg =
      primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
    attemptsLog.push(`${primary}: failed (${msg})`);

    if (primary === OPENROUTER_FALLBACK_MODEL) {
      console.warn("[openrouter] failed; primary is already fallback", {
        label,
        attemptsLog,
      });
      throw primaryErr;
    }

    attemptsLog.push(`fallback → ${OPENROUTER_FALLBACK_MODEL}`);
    try {
      const out = await runWith429Retry(OPENROUTER_FALLBACK_MODEL);
      attemptsLog.push(`${OPENROUTER_FALLBACK_MODEL}: ok (fallback)`);
      console.info("[openrouter] succeeded", {
        label,
        modelUsed: OPENROUTER_FALLBACK_MODEL,
        fallbackFrom: primary,
        attemptsLog,
      });
      return {
        ...out,
        modelUsed: OPENROUTER_FALLBACK_MODEL,
        attemptsLog,
      };
    } catch (fallbackErr) {
      console.warn("[openrouter] fallback failed", {
        label,
        attemptsLog,
        error:
          fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
      });
      throw fallbackErr;
    }
  }
}

/**
 * Pull the first JSON object out of a string. Models sometimes wrap output in
 * ```json fences or add a sentence before/after. This grabs the outermost
 * balanced { ... } block.
 */
export function extractJson<T>(text: string): T {
  const trimmed = text.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  const start = candidate.indexOf("{");
  if (start === -1) {
    throw new Error(`Model output contained no JSON object: ${text.slice(0, 200)}`);
  }

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const slice = candidate.slice(start, i + 1);
        try {
          return JSON.parse(slice) as T;
        } catch (e) {
          throw new Error(
            `Failed to parse extracted JSON: ${(e as Error).message}\n---\n${slice.slice(0, 500)}`,
          );
        }
      }
    }
  }

  throw new Error(
    `Unbalanced braces in model output: ${candidate.slice(0, 200)}`,
  );
}

// ---------------------------------------------------------------------------
// Mock mode — short-circuits everything so the pipeline runs without keys.
// ---------------------------------------------------------------------------

export function mockEnabled(): boolean {
  return process.env.MOCK_OPENROUTER === "1";
}

export const MOCK_CLUE_EXTRACTION: ClueExtraction = {
  onscreen_text_overlays: [
    "DOWNTOWN AUSTIN",
    "studios start at $1596",
    "offering 6 weeks free",
  ],
  other_visible_text: [
    "Indeed Tower (visible through window)",
    "Whataburger sign on street below",
  ],
  landmarks_spotted: ["Indeed Tower", "Frost Bank Tower"],
  view_direction: "East-facing view of downtown Austin skyline",
  apartment_tier: "luxury",
  notable_features: [
    "Floor-to-ceiling windows",
    "Quartz waterfall island",
    "Private balcony with glass railing",
  ],
  estimated_floor: "high-rise (estimated 20th-30th floor)",
  neighborhood_clues: ["Downtown Austin", "Near 6th Street"],
  price_clues: "Studios from $1596, 6 weeks free move-in special",
  search_queries: [
    "downtown Austin high rise apartment buildings list",
    "all downtown Austin luxury apartment complexes",
    "Austin apartment view of Indeed Tower",
    "Austin apartment near Frost Bank Tower downtown",
    "Austin apartment locator downtown studio $1596 6 weeks free deal",
    "downtown Austin luxury apartment studios $1596 6 weeks free",
    "@apartmenthunter Austin apartment tour",
  ],
};

export const MOCK_FETCHED_PAGES: FetchedPage[] = [
  {
    url: "https://www.apartments.com/the-bowie-austin-tx/abc123/",
    title: "The Bowie Apartments - Austin, TX | Apartments.com",
    content: `The Bowie Apartments
311 Bowie St, Austin, TX 78703

Studio, 1 BR and 2 BR floor plans starting at $1,596.

About The Bowie
The Bowie is a 36-story luxury high-rise in downtown Austin, just steps from the 2nd Street District and Lady Bird Lake. Floor-to-ceiling windows in every unit showcase panoramic views of the Austin skyline including the Frost Bank Tower and Indeed Tower.

Special Offers
- 6 weeks free on select studios and 1 BRs
- Reduced deposit for qualified applicants

Amenities
- Rooftop pool with skyline view
- 24-hour fitness center
- Resident lounge with private dining room
- Pet spa
- Concierge

Floor Plans
Studio - from $1,596
1 BR - from $2,150
2 BR - from $3,200`,
    htmlBytes: 187432,
    fetchedAt: new Date().toISOString(),
  },
  {
    url: "https://www.thebowie.com",
    title: "The Bowie | Downtown Austin Luxury Apartments",
    content: `THE BOWIE
DOWNTOWN AUSTIN

Now leasing studios, 1 and 2 bedrooms. Studios from $1,596. Limited-time offer: 6 weeks free.

Live above downtown Austin in a building designed for the city's pace. Floor-to-ceiling windows. Quartz waterfall islands. Skyline views of the Frost Bank and Indeed Towers.

Schedule a tour
Call (512) 555-0142
311 Bowie St, Austin, TX 78703`,
    htmlBytes: 94216,
    fetchedAt: new Date().toISOString(),
  },
  {
    url: "https://www.zumper.com/apartments/the-bowie-austin-tx",
    title: "The Bowie, Austin — Listings | Zumper",
    content: `The Bowie — 311 Bowie St, Austin TX 78703. Studios from $1,596. 6 weeks free on select units. Luxury high-rise downtown near 2nd Street District.`,
    htmlBytes: 88200,
    fetchedAt: new Date().toISOString(),
  },
  {
    url: "https://www.apartmentlist.com/tx/austin/the-bowie",
    title: "The Bowie Apartments for Rent in Austin",
    content: `Rent at The Bowie in Downtown Austin. Floor-to-ceiling windows, skyline views, studios and 1–2 bedrooms. Specials: reduced rent and weeks free on select homes.`,
    htmlBytes: 76500,
    fetchedAt: new Date().toISOString(),
  },
  {
    url: "https://smartcitylocating.com/austin/deals/the-bowie-studio-special",
    title: "The Bowie studio special — Smart City Locating",
    content: `Downtown Austin: The Bowie — studios from $1596, 6 weeks free. High-rise with Indeed Tower views. 311 Bowie St. Contact for tour.`,
    htmlBytes: 41200,
    fetchedAt: new Date().toISOString(),
  },
];

/**
 * Mock visual verifications keyed by candidate name. The route's mock-mode
 * branch looks up by exact match.name; falls back to the "default" entry.
 */
export const MOCK_VISUAL_VERIFICATIONS: Record<
  string,
  Omit<VisualVerification, "originalConfidence" | "adjustedConfidence">
> = {
  "The Bowie": {
    status: "STRONG_MATCH",
    reasoning:
      "The waterfall quartz island, floor-to-ceiling windows with black mullions, and the east-facing skyline view with Indeed Tower all align between the video and the listing photos.",
    matchedFeatures: [
      "Waterfall-edge quartz island with same vein pattern",
      "Floor-to-ceiling windows with black mullions",
      "East-facing skyline view including Indeed Tower",
      "Engineered hardwood flooring in matching warm-oak tone",
      "Pendant lighting style over the island",
    ],
    mismatchedFeatures: [
      "Cabinet pulls in the video appear bronze; listing shows brushed nickel (could be a different unit)",
    ],
    candidatePhotos: [
      "https://www.thebowie.com/images/gallery/kitchen-1.jpg",
      "https://www.thebowie.com/images/gallery/living-room-1.jpg",
      "https://www.thebowie.com/images/gallery/skyline-view.jpg",
    ],
  },
  "70 Rainey": {
    status: "NO_MATCH",
    confidencePenaltyBucket: "full_building",
    reasoning:
      "The cabinet color, countertop material, and view geometry all clearly differ. 70 Rainey has light grey cabinets and a south-facing view; the video shows white shaker cabinets with an east-facing view.",
    matchedFeatures: ["Modern luxury tier", "Floor-to-ceiling windows"],
    mismatchedFeatures: [
      "Cabinet color (video: white, candidate: grey)",
      "View direction (video: east, candidate: south)",
      "Countertop edge (video: waterfall, candidate: standard square)",
      "Flooring (video: warm oak, candidate: cool grey)",
    ],
    candidatePhotos: [
      "https://www.70rainey.com/gallery/kitchen.jpg",
      "https://www.70rainey.com/gallery/view.jpg",
    ],
  },
  default: {
    status: "PARTIAL_MATCH",
    reasoning:
      "Some general styling matches (luxury tier, modern finishes) but no distinctive details confirm or refute this candidate.",
    matchedFeatures: ["Modern luxury tier"],
    mismatchedFeatures: [],
    candidatePhotos: [],
  },
};

export const MOCK_CANDIDATE_ANALYSIS: CandidateAnalysis = {
  matches: [
    {
      name: "The Bowie",
      confidence: 86,
      address: "311 Bowie St, Austin, TX 78703",
      website: "https://www.thebowie.com",
      evidence_for: [
        "Indeed Tower visible from upper east-facing floors",
        "Floor-to-ceiling windows match listing photos",
        "Studio pricing in the $1,500-1,700 band",
      ],
      evidence_against: [
        "Cabinet finish in the video looks slightly darker than listing photos",
      ],
      reasoning:
        "Sightline to Indeed Tower from a high east-facing studio + matching pricing band + 6-weeks-free promo cadence all point to The Bowie.",
    },
    {
      name: "70 Rainey",
      confidence: 41,
      address: "70 Rainey St, Austin, TX 78701",
      website: "https://www.70rainey.com",
      evidence_for: ["Downtown Austin high-rise", "Floor-to-ceiling windows"],
      evidence_against: [
        "Indeed Tower not typically framed from 70 Rainey's view direction",
        "Studio pricing is usually higher",
      ],
      reasoning:
        "Plausible downtown high-rise, but the skyline geometry doesn't fully match.",
    },
    {
      name: "Austin Proper Residences",
      confidence: 22,
      address: "",
      website: "https://www.austinproper.com",
      evidence_for: [
        "Downtown luxury high-rise tier matches",
        "Mentioned in some downtown studio roundup results",
      ],
      evidence_against: [
        "Weak direct alignment with Indeed Tower sightline from search snippets",
        "Pricing/specials not corroborated in evidence",
      ],
      reasoning:
        "Low-confidence geographic/tier guess to complete three candidates; verify visually.",
    },
  ],
  overall_confidence: "high",
  limiting_factors: ["This response is from MOCK_OPENROUTER mode — not a real model call."],
};
