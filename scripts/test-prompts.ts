// Confirms the prompt builders inject the right age-tier text.
import {
  buildCandidateAnalysisUserPrompt,
  buildClueExtractionUserPrompt,
} from "../lib/prompts";
import type {
  AnalyzeRequest,
  ClueExtraction,
  VideoMetadata,
} from "../lib/types";

const baseRequest: AnalyzeRequest = {
  city: "Austin, TX",
  priceRange: "1500-2000",
  additionalContext: "Downtown high-rise",
};

const baseClues: ClueExtraction = {
  onscreen_text_overlays: ["studios start at $1596", "6 weeks free"],
  other_visible_text: [],
  landmarks_spotted: ["Indeed Tower"],
  view_direction: "east",
  apartment_tier: "luxury",
  notable_features: ["floor-to-ceiling windows"],
  estimated_floor: "high-rise",
  neighborhood_clues: ["Downtown Austin"],
  price_clues: "studios from $1596",
  search_queries: [],
};

const scenarios: Array<{
  name: string;
  ageMonths: number | null;
  noMetadata?: boolean;
}> = [
  { name: "RECENT (1 month old)", ageMonths: 1.0 },
  { name: "MEDIUM (6 months old)", ageMonths: 6.0 },
  { name: "OLD (24 months old)", ageMonths: 24.0 },
  { name: "UNKNOWN (no metadata)", ageMonths: null, noMetadata: true },
];

const expectations: Record<string, string[]> = {
  "RECENT (1 month old)": ["STRONG matching signals", "HEAVILY PENALIZE"],
  "MEDIUM (6 months old)": ["SOFT signal", "do NOT disqualify"],
  "OLD (24 months old)": ["IGNORE pricing", "Rely SOLELY on location"],
  "UNKNOWN (no metadata)": ["MODERATE signal"],
};

for (const s of scenarios) {
  console.log("\n" + "=".repeat(70));
  console.log(s.name);
  console.log("=".repeat(70));

  const metadata: VideoMetadata | null = s.noMetadata
    ? null
    : {
        caption: "Best apartment in Austin",
        hashtags: ["austinapartments"],
        creator: "apartmenthunter",
        thumbnailUrl: null,
        frames: [],
        source: "tiktok",
        videoId: "7234567890123456789",
        creationDate: new Date(
          Date.now() - (s.ageMonths ?? 0) * 30.4375 * 24 * 3600 * 1000,
        ).toISOString(),
        ageMonths: s.ageMonths,
      };

  const cluePrompt = buildClueExtractionUserPrompt({
    request: baseRequest,
    metadata,
  });
  const candidatePrompt = buildCandidateAnalysisUserPrompt({
    request: baseRequest,
    clues: baseClues,
    searchResults: [],
    fetchedPages: [],
    metadata,
  });

  console.log("\n-- Candidate prompt — VIDEO AGE CONTEXT block --");
  const block = candidatePrompt.match(
    /=== VIDEO AGE CONTEXT ===([\s\S]*?)=== EXTRACTED CLUES ===/,
  );
  if (block) {
    for (const line of block[1].trim().split("\n")) {
      console.log("  " + line);
    }
  }

  console.log("\n-- Clue prompt — age-aware search guidance --");
  const guidance = cluePrompt.match(
    /AGE-AWARE SEARCH GUIDANCE for THIS video: (.+)/,
  );
  if (guidance) console.log("  " + guidance[1]);

  console.log("\n-- Expected phrases present in candidate prompt? --");
  for (const phrase of expectations[s.name] ?? []) {
    const hit = candidatePrompt.includes(phrase);
    console.log(`  ${hit ? "OK " : "XX "}  "${phrase}"`);
  }
}

console.log("\n" + "=".repeat(70));
console.log("Search query construction rules — verify presence in clue prompt");
console.log("=".repeat(70));
const sample = buildClueExtractionUserPrompt({
  request: baseRequest,
  metadata: {
    caption: null,
    hashtags: [],
    creator: "creator123",
    thumbnailUrl: null,
    frames: [],
    source: "tiktok",
    creationDate: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
    ageMonths: 1,
  },
});
const ruleChecks = [
  "EXACT prices",
  "EXACT promotional language",
  "EXACT unit type",
  "$1596",
  "6 weeks free",
  "luxury downtown Austin apartment",
  // Multi-clue + inventory + landmark + locator rules
  "MULTI-CLUE COMBINATIONS (REQUIRED)",
  "BROAD INVENTORY QUERY (REQUIRED",
  "LANDMARK / SPATIAL QUERIES (REQUIRED when windows show outdoor views",
  "Austin studio $1596 6 weeks free 2025",
  "Austin apartment floor to ceiling windows downtown studio under 1600",
  "Austin apartment view of Indeed Tower",
  "LOCATOR-STYLE QUERY (REQUIRED",
  "Do NOT use",
  "site:",
  "6 or 7",
  "Do NOT just say cityscape or skyline",
];
for (const c of ruleChecks) {
  console.log(`  ${sample.includes(c) ? "OK " : "XX "}  "${c}"`);
}

console.log("\n" + "=".repeat(70));
console.log("Social-media filter — verify presence in candidate prompt");
console.log("=".repeat(70));
const candidateSample = buildCandidateAnalysisUserPrompt({
  request: baseRequest,
  clues: baseClues,
  searchResults: [],
  fetchedPages: [],
  metadata: null,
});
const filterChecks = [
  "WHAT IS NOT A MATCH (CRITICAL FILTERING RULE)",
  "NOT the original video or the social media post",
  "SKIP IT ENTIRELY",
  "tiktok.com, vm.tiktok.com, vt.tiktok.com",
  "instagram.com",
  "youtube.com",
  "apartments.com, zillow.com",
  "READ a social media result as supporting evidence",
];
for (const c of filterChecks) {
  console.log(`  ${candidateSample.includes(c) ? "OK " : "XX "}  "${c}"`);
}

console.log("\n" + "=".repeat(70));
console.log("Fetched-page section — verify presence in candidate prompt");
console.log("=".repeat(70));
const candidateWithPage = buildCandidateAnalysisUserPrompt({
  request: baseRequest,
  clues: baseClues,
  searchResults: [],
  fetchedPages: [
    {
      url: "https://www.apartments.com/the-bowie-austin-tx/abc123/",
      title: "The Bowie Apartments - Austin, TX | Apartments.com",
      content:
        "The Bowie Apartments\n311 Bowie St, Austin, TX 78703\nStudios from $1,596.",
      htmlBytes: 187432,
      fetchedAt: new Date().toISOString(),
    },
  ],
  metadata: null,
});
const pageChecks = [
  "=== FETCHED LISTING PAGE CONTENT ===",
  "PRIMARY EVIDENCE",
  "PAGE 1",
  "URL: https://www.apartments.com/the-bowie-austin-tx",
  "TITLE: The Bowie Apartments",
  "311 Bowie St, Austin, TX 78703",
  "When the FETCHED LISTING PAGE CONTENT names a building",
];
for (const c of pageChecks) {
  console.log(`  ${candidateWithPage.includes(c) ? "OK " : "XX "}  "${c}"`);
}

console.log("\n" + "=".repeat(70));
console.log("Candidate prompt — exactly-three rule");
console.log("=".repeat(70));
const threeChecks = [
  "EXACTLY THREE CANDIDATES (MANDATORY)",
  "exactly **3**",
  "**Never** return fewer than 3 candidates",
];
for (const c of threeChecks) {
  console.log(`  ${candidateSample.includes(c) ? "OK " : "XX "}  "${c}"`);
}
