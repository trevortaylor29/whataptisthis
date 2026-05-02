/**
 * End-to-end smoke test for /api/analyze.
 *
 * Hardcoded test case (per spec § "First Thing To Build"):
 *   A known downtown Austin luxury high-rise. We feed in the kind of
 *   text-overlay clues that real TikTok apartment tours show, plus two
 *   small synthetic screenshots, and assert the pipeline returns a
 *   well-formed analysis.
 *
 * Modes:
 *   - MOCK_OPENROUTER=1  → uses canned model/search responses. No keys needed.
 *                          Verifies all routing, validation, and JSON shape.
 *   - MOCK_OPENROUTER=0  → real OpenRouter + Serper calls. Requires both keys.
 *                          This is the actual feasibility test.
 *
 * Run:
 *   # Mock (no keys):
 *   $env:MOCK_OPENROUTER="1"; npm run test:analyze
 *
 *   # Live:
 *   $env:OPENROUTER_API_KEY="sk-or-..."; $env:SERPER_API_KEY="..."; npm run test:analyze
 */

const PORT = process.env.PORT ?? "3000";
const BASE = process.env.TEST_BASE_URL ?? `http://127.0.0.1:${PORT}`;

// Two tiny, valid JPEGs (1x1 pixel) encoded as data URLs. The vision model
// won't extract real clues from these — that's fine, mock mode short-circuits
// the model call, and live mode will still exercise the full request shape.
// Replace with real apartment screenshots to do a real feasibility test.
const TINY_JPEG_DATA_URL =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==";

const TEST_REQUEST = {
  city: "Austin, TX",
  tiktokUrl: "https://www.tiktok.com/@example/video/1234567890",
  visitorId: "test-script-visitor",
  priceRange: "1500-2000",
  additionalContext:
    "TikTok video showed text overlays: 'DOWNTOWN AUSTIN', 'studios start at $1596', 'offering 6 weeks free'. East-facing high-rise, Indeed Tower visible through floor-to-ceiling windows. Quartz waterfall island in kitchen.",
  // Two screenshots, as specified in "First Thing To Build".
  screenshots: [TINY_JPEG_DATA_URL, TINY_JPEG_DATA_URL],
};

interface AnalyzeOk {
  ok: true;
  city: string;
  videoMetadata: unknown;
  clueExtractionVision: {
    totalImagesSent: number;
    clueExtractionUsedLiveVision: boolean;
    countsBySource: {
      oembed_thumbnail: number;
      video_frame: number;
      user_screenshot: number;
    };
    images: Array<{ index: number; source: string; label: string }>;
  };
  clues: {
    onscreen_text_overlays: string[];
    other_visible_text: string[];
    landmarks_spotted: string[];
    search_queries: string[];
    [k: string]: unknown;
  };
  searchResults: Array<{ query: string; hits: unknown[] }>;
  analysis: {
    matches: Array<{
      name: string;
      confidence: number;
      address: string;
      website: string;
      reasoning: string;
    }>;
    overall_confidence: string;
    limiting_factors: string[];
  };
  timings: Record<string, number>;
  warnings: string[];
}

interface AnalyzeErr {
  ok: false;
  error: string;
  details?: string;
}

function header(s: string) {
  const bar = "─".repeat(s.length + 2);
  console.log(`\n┌${bar}┐\n│ ${s} │\n└${bar}┘`);
}

function ok(label: string) {
  console.log(`  \x1b[32m✓\x1b[0m ${label}`);
}

function fail(label: string, detail?: string): never {
  console.log(`  \x1b[31m✗\x1b[0m ${label}`);
  if (detail) console.log(`     ${detail}`);
  process.exit(1);
}

async function main() {
  const mock = process.env.MOCK_OPENROUTER === "1";

  header(`Hitting ${BASE}/api/analyze (${mock ? "MOCK" : "LIVE"} mode)`);

  // Health check first so we get a clear error if the dev server isn't up.
  try {
    const ping = await fetch(`${BASE}/api/analyze`, { method: "GET" });
    if (!ping.ok) {
      fail(
        `Health check returned ${ping.status}. Is \`npm run dev\` running on port ${PORT}?`,
      );
    }
    ok(`Server reachable (GET /api/analyze → ${ping.status})`);
  } catch (e) {
    fail(
      "Could not reach the dev server.",
      `Run \`npm run dev\` in another terminal, then re-run this test. (${(e as Error).message})`,
    );
  }

  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/analyze?dev=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(TEST_REQUEST),
  });
  const elapsed = Date.now() - t0;
  ok(`POST /api/analyze responded in ${elapsed}ms with status ${res.status}`);

  const json = (await res.json()) as AnalyzeOk | AnalyzeErr;

  if (!json.ok) {
    console.log("\n  Server returned an error response:");
    console.log(`    error:   ${json.error}`);
    if (json.details) console.log(`    details: ${json.details}`);
    if (mock) {
      fail("Mock mode should not error. Pipeline is broken.");
    } else {
      console.log(
        "\n  ℹ  In LIVE mode this usually means a missing/invalid API key or",
      );
      console.log(
        "     a model slug that no longer exists on OpenRouter. Try MOCK_OPENROUTER=1",
      );
      console.log("     to verify the pipeline is wired correctly.");
      process.exit(1);
    }
  }

  // ---- Schema assertions ------------------------------------------------
  header("Schema checks");
  if (json.city !== TEST_REQUEST.city) {
    fail(`city echoed back wrong: got "${json.city}"`);
  }
  ok(`city echoed back: "${json.city}"`);

  const v = json.clueExtractionVision;
  if (!v || typeof v.totalImagesSent !== "number") {
    fail("clueExtractionVision missing or malformed");
  }
  if (TEST_REQUEST.screenshots && TEST_REQUEST.screenshots.length > 0) {
    const n = TEST_REQUEST.screenshots.length;
    if (v.countsBySource.user_screenshot !== n) {
      fail(
        `Expected ${n} user screenshot(s) in clue-extraction vision, got ${v.countsBySource.user_screenshot}`,
      );
    }
    if (v.totalImagesSent < n) {
      fail(
        `clueExtractionVision.totalImagesSent (${v.totalImagesSent}) < uploaded screenshots (${n})`,
      );
    }
  }
  ok(
    `clue extraction vision: ${v.totalImagesSent} image(s) ` +
      `(thumb ${v.countsBySource.oembed_thumbnail}, video ${v.countsBySource.video_frame}, ` +
      `screenshots ${v.countsBySource.user_screenshot}), live=${v.clueExtractionUsedLiveVision}`,
  );

  const c = json.clues;
  for (const key of [
    "onscreen_text_overlays",
    "other_visible_text",
    "landmarks_spotted",
    "search_queries",
  ] as const) {
    if (!Array.isArray(c[key])) fail(`clues.${key} is not an array`);
  }
  ok(
    `clues object has all required arrays (overlays=${c.onscreen_text_overlays.length}, ` +
      `landmarks=${c.landmarks_spotted.length}, queries=${c.search_queries.length})`,
  );

  if (!Array.isArray(json.searchResults)) {
    fail("searchResults missing or not an array");
  }
  const totalHits = json.searchResults.reduce((n, q) => n + q.hits.length, 0);
  ok(
    `searchResults: ${json.searchResults.length} queries, ${totalHits} hits total`,
  );

  if (!json.analysis || !Array.isArray(json.analysis.matches)) {
    fail("analysis.matches missing or not an array");
  }
  ok(
    `analysis.matches: ${json.analysis.matches.length} candidate(s), overall_confidence=${json.analysis.overall_confidence}`,
  );

  for (const [i, m] of json.analysis.matches.entries()) {
    if (typeof m.confidence !== "number" || m.confidence < 0 || m.confidence > 100) {
      fail(`match[${i}].confidence is not a 0-100 number (got ${m.confidence})`);
    }
    if (typeof m.name !== "string" || m.name.length === 0) {
      fail(`match[${i}].name is empty`);
    }
  }
  ok("Every match has a valid name + 0-100 confidence");

  // Confidence ordering
  const confidences = json.analysis.matches.map((m) => m.confidence);
  for (let i = 1; i < confidences.length; i++) {
    if (confidences[i]! > confidences[i - 1]!) {
      fail("Matches are not sorted by confidence descending");
    }
  }
  ok("Matches sorted by confidence (descending)");

  // ---- Pretty print -----------------------------------------------------
  header("Top match");
  const top = json.analysis.matches[0];
  if (top) {
    console.log(`  ${top.name}  —  ${top.confidence}% confidence`);
    console.log(`  ${top.address}`);
    console.log(`  ${top.website}`);
    console.log(`  Reasoning: ${top.reasoning}`);
  } else {
    console.log("  (no matches returned — that's a valid result if confidence was too low)");
  }

  header("Timings");
  for (const [k, v] of Object.entries(json.timings)) {
    console.log(`  ${k.padEnd(24)} ${v}ms`);
  }

  if (json.warnings.length > 0) {
    header("Warnings");
    for (const w of json.warnings) console.log(`  • ${w}`);
  }

  console.log("\n\x1b[32mPipeline test passed.\x1b[0m");
  if (mock) {
    console.log(
      "Run again with real OPENROUTER_API_KEY + SERPER_API_KEY (and MOCK_OPENROUTER unset) for the actual feasibility test.",
    );
  }
}

main().catch((e) => {
  console.error("\n\x1b[31mUnhandled error:\x1b[0m", e);
  process.exit(1);
});
