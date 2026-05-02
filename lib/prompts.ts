import type {
  AnalyzeRequest,
  ApartmentMatch,
  ClueExtraction,
  FetchedPage,
  QuerySearchResult,
  SpatialLandmarkCandidate,
  VideoMetadata,
} from "./types";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface AgeTier {
  /** Short label for the tier — appears in the prompt header. */
  label: string;
  /** What clue extraction should do with pricing when generating queries. */
  searchGuidance: string;
  /** What candidate analysis should do with pricing when scoring matches. */
  scoringPolicy: string;
}

function ageTier(ageMonths: number | null | undefined): AgeTier {
  if (ageMonths == null || isNaN(ageMonths)) {
    return {
      label: "unknown age",
      searchGuidance:
        "Include exact pricing/promotional details in queries if present, but also generate at least one query that omits them in case the listing has changed.",
      scoringPolicy:
        "Treat pricing/promotions as a MODERATE signal. Use them to surface candidates and add weight when they match, but do NOT disqualify a candidate solely on pricing/promo mismatch.",
    };
  }
  if (ageMonths < 3) {
    return {
      label: `recent (~${ageMonths.toFixed(1)} months old)`,
      searchGuidance:
        "Include EXACT pricing and EXACT promotional offers in your queries verbatim — for a video this fresh, the listing should still match.",
      scoringPolicy:
        "Treat pricing and promotional details as STRONG matching signals. HEAVILY PENALIZE any candidate whose currently-listed price band, unit type, or active promotion clearly contradicts the video. A confidence score above 60 requires the pricing/promo details to plausibly align.",
    };
  }
  if (ageMonths < 12) {
    return {
      label: `medium age (~${ageMonths.toFixed(1)} months old)`,
      searchGuidance:
        "Use exact pricing/promotional details in 1-2 queries to surface the building, but ALSO include queries that omit them — pricing may have shifted in the months since the post.",
      scoringPolicy:
        "Treat pricing as a SOFT signal. Use it to surface and rank candidates, but do NOT disqualify a candidate solely on pricing mismatch — apartments commonly adjust pricing every few months. Promotions are more time-sensitive: a mild penalty is appropriate when the specific promo (e.g. '6 weeks free') clearly isn't currently offered, but it is not disqualifying.",
    };
  }
  return {
    label: `old (~${ageMonths.toFixed(1)} months old)`,
    searchGuidance:
      "DO NOT include pricing or promotional details in your search queries. Build queries around location, landmarks, building name fragments, and structural/visual features only.",
    scoringPolicy:
      "IGNORE pricing and promotional details entirely as matching criteria. The apartment's current pricing is almost certainly different from what the video showed. Rely SOLELY on location, visual identifiers (landmarks, view direction, building shape, exterior), and structural/finish features (window style, balcony type, finishes). Pricing should not appear in evidence_for or evidence_against.",
  };
}

function buildVideoAgeBlock(metadata: VideoMetadata | null): string {
  const tier = ageTier(metadata?.ageMonths ?? null);
  const dateLine = metadata?.creationDate
    ? `Video posted: ${metadata.creationDate} (${tier.label})`
    : "Video creation date: UNKNOWN";
  return `${dateLine}
Pricing weight policy for THIS video: ${tier.scoringPolicy}`;
}

// ---------------------------------------------------------------------------
// Step 2 — Clue extraction
// ---------------------------------------------------------------------------

export const CLUE_EXTRACTION_SYSTEM_PROMPT = `You are an apartment identification expert. You analyze TikTok/Instagram apartment tour videos to identify which specific apartment building is being shown.

Given the following evidence from an apartment video, extract every possible identifying clue. Treat corporate logos, company names, and signage on any visible building (including neighbors) as extremely strong signals; pair them with landmark-specific search queries when present. Return ONLY a single JSON object that matches the schema described in the user message. Do not wrap it in markdown fences.`;

export function buildClueExtractionUserPrompt(args: {
  request: AnalyzeRequest;
  metadata: VideoMetadata | null;
}): string {
  const { request, metadata } = args;
  const caption = metadata?.caption ?? "not available";
  const hashtags =
    metadata?.hashtags && metadata.hashtags.length > 0
      ? metadata.hashtags.join(", ")
      : "not available";
  const creator = metadata?.creator ?? "not available";
  const tier = ageTier(metadata?.ageMonths ?? null);
  const ageLine = metadata?.creationDate
    ? `Video posted: ${metadata.creationDate} (${tier.label})`
    : "Video creation date: unknown";

  return `City: ${request.city}
Price range: ${request.priceRange ?? "not specified"}
Additional context from user: ${request.additionalContext ?? "none"}

Video caption: ${caption}
Hashtags: ${hashtags}
Creator: ${creator}
${ageLine}

[Attached: screenshots/frames from the video]

TASK (in priority order):
1. **#1 PRIORITY — ON-SCREEN TEXT OVERLAYS:** TikTok/Reels creators almost always add text overlays directly on the video with info like city, price, unit type, move-in specials, neighborhood name. Read ALL of these first. This is your single most valuable signal. Examples: "DOWNTOWN AUSTIN", "studios start at $1596", "offering 6 weeks free", "2BR/2BA starting at $2,400".
2. Read ALL other visible text in every image (signs, logos, building names, street signs, nearby business names, anything on walls/doors/elevators).
3. Identify any recognizable landmarks or buildings visible through windows or in the background.
4. Note the style/tier of the apartment (luxury high-rise, mid-range garden style, etc.).
5. Note specific features (floor-to-ceiling windows, balcony type, pool visible, specific finishes).
6. Estimate which floor/height based on the view.
7. Note any neighborhood clues.

=== CORPORATE LOGOS, SIGNAGE & BRANDING (EXTREMELY HIGH VALUE) ===
Look carefully at ALL buildings visible in every frame. If any building displays a corporate logo, company name, or signage (like Google, Meta, Apple, Indeed, Amazon, etc.), this is an EXTREMELY high-value clue. Report it immediately in \`landmarks_spotted\` with the format: [Company name] office/building visible from [location in frame]. Also look for any text on buildings, construction signage, street-level business names, or any identifiable branding. A corporate logo on a neighboring building can instantly identify the apartment location.

=== SPECIFIC VISUAL DESCRIPTIONS (REQUIRED) ===
For EVERY building visible through windows or in the background, describe its specific visual characteristics — color, shape, distinctive architectural features, signage, murals, construction cranes, anything unique. Do NOT just say cityscape or skyline. Describe individual buildings you can see. For example: tall building with blue/teal glass facade to the south, shorter brown brick building to the east, construction crane visible to the northwest. Also describe the apartment building itself if any exterior shots are shown — what color is the building, what does the facade look like, any distinctive architectural features. These details are critical for identification.

=== SEARCH QUERY CONSTRUCTION RULES ===
The "search_queries" field is critical. They will be sent to Google verbatim. Generic queries waste a search slot. Follow these rules:

- Use the EXACT prices you read from overlays. "$1596" — NEVER round to "$1500" or "around $1600".
- Use the EXACT promotional language verbatim. "6 weeks free" — NEVER paraphrase to "move-in special".
- Use the EXACT unit type. "studio", "1BR/1BA", "2BR/2BA" — match the video's wording.
- One query should combine the most distinctive landmark/feature with the city.
- One query should combine the creator's @handle with the city (creators often tag the building in other posts).
- Combine multiple highly specific signals in ONE query when possible — Google handles long queries well.

MULTI-CLUE COMBINATIONS (REQUIRED):
At least 2 of your queries MUST stack multiple specific clues together to narrow Google's result set down to ideally 1-3 buildings. A single signal (e.g. just a price, just a city) returns thousands of irrelevant results; stacking 3-4 specific signals usually returns a near-perfect match.

BROAD INVENTORY QUERY (REQUIRED — always include exactly one):
Goal: surface comprehensive listicles and roundups of buildings in the area, not a single unit listing. These pages enumerate many towers so you can cross-check names against the video.
  ✓ "downtown Austin high rise apartment buildings list"
  ✓ "all downtown Austin luxury apartment complexes"
  ✓ "Austin 78701 luxury high rise towers roundup"
Adapt neighborhood and tier (luxury vs mid-range) to the clues. For OLD videos per age guidance, omit price from this query and focus on location + building inventory.

LANDMARK / SPATIAL QUERIES (REQUIRED when windows show outdoor views, a cityscape, OR any identifiable outdoor feature):
- If you see specific buildings, towers, bridges, stadiums, parks, or distinctive features through the windows, generate queries like:
  "{city} apartment near [landmark]", "{city} apartment view of [landmark]", "{city} high rise overlooking [landmark]".
- If you can infer an approximate street, corridor, or intersection from the view (street signs, geometry, known sightlines), search for that, e.g. "{city} apartment [Street Name]" or "{city} apartment 2nd and Bowie".
- For a generic cityscape: try to name the most prominent visible towers (by shape/spire/color if you know the skyline) and run view/near queries for those names — do not stop at "downtown skyline" if finer identification is possible.

LANDMARK / CORPORATE TARGET QUERIES (REQUIRED whenever applicable):
If you identify ANY corporate logo, named building, or specific business visible from the apartment, generate a search query specifically for it — for example: "{city} apartment next to [company] office", or "{city} apartment building near [company] [city]". This is likely the single most useful search query you can generate. Include at least one such query in \`search_queries\` whenever logos, named towers, or storefront-level businesses are visible (even on neighboring buildings).

GOOD examples (highly specific, distinctive, multi-clue):
  ✓ "Austin studio $1596 6 weeks free 2025"
  ✓ "Austin apartment floor to ceiling windows downtown studio under 1600"
  ✓ "Austin apartment view of Indeed Tower"
  ✓ "Austin high rise overlooking Lady Bird Lake"
  ✓ "Austin 2BR 2BA $2400 floor to ceiling windows quartz waterfall island"
  ✓ "@${creator} apartment tour Austin"

BAD examples (too generic, will return useless results):
  ✗ "luxury downtown Austin apartment"
  ✗ "Austin apartment around $1500"
  ✗ "modern high rise Austin"

GOAL: Each targeted (non-inventory) query should be specific enough that only a handful of buildings could plausibly match. If you can imagine your query returning a thousand generic apartment listings, rewrite it with more stacked clues.

LOCATOR-STYLE QUERY (REQUIRED — always include exactly one):
Apartment locator / leasing-concierge pages often name the *actual building* in deal posts. You MUST output one query that reads like a natural Google search — city + strongest clues (price, promo, unit type, neighborhood, "downtown", "high rise") + phrasing such as "apartment locator", "leasing special", or "deal".

- Do NOT use \`site:\`, \`OR site:\`, or any forced domain narrowing in ANY \`search_queries\` entry. The server adds social/video \`-site:\` exclusions automatically; mixing \`site:\` with exclusions hurts results. Let Google rank naturally.
  ✓ "Austin apartment locator downtown studio $1596 6 weeks free deal"
  ✓ "Austin apartment leasing special studio $1596 downtown high rise"

QUERY COUNT: Return **6 or 7** strings in \`search_queries\`: include the required broad-inventory query, the required locator-style query, at least two multi-clue targeted queries, landmark/spatial queries when the view supports them, and the @handle query when a creator handle is known — without dropping the required slots above.

AGE-AWARE SEARCH GUIDANCE for THIS video: ${tier.searchGuidance}

Return a structured JSON object exactly matching this schema (all keys required, arrays may be empty):
{
  "onscreen_text_overlays": string[],
  "other_visible_text": string[],
  "landmarks_spotted": string[],
  "view_direction": string,
  "apartment_tier": "luxury" | "mid-range" | "budget",
  "notable_features": string[],
  "estimated_floor": string,
  "neighborhood_clues": string[],
  "price_clues": string,
  "search_queries": string[]   // 6-7 queries per QUERY COUNT + rules above
}`;
}

// ---------------------------------------------------------------------------
// Step 4 — Candidate analysis
// ---------------------------------------------------------------------------

export const CANDIDATE_ANALYSIS_SYSTEM_PROMPT = `You are an apartment identification expert. Based on clues extracted from a TikTok apartment video, optional Serper Places “apartments near landmark” hypotheses (when provided), and web search results, determine which apartment building is most likely shown in the video.

When on-screen text, caption, or hashtags explicitly name a street, neighborhood, or district, treat that as a hard location constraint: candidates whose address or neighborhood clearly conflict must receive a severe confidence penalty (see user message). Pair each building **name** with the **address** from the same source entry — never mix labels across listicle rows. Return ONLY a single JSON object matching the schema in the user message. Do not wrap it in markdown fences.`;

export function buildCandidateAnalysisUserPrompt(args: {
  clues: ClueExtraction;
  searchResults: QuerySearchResult[];
  fetchedPages: FetchedPage[];
  request: AnalyzeRequest;
  metadata: VideoMetadata | null;
  /** Apartment POIs within ~500m of geocoded landmarks (Serper Places). */
  spatialLandmarkCandidates?: SpatialLandmarkCandidate[];
}): string {
  const {
    clues,
    searchResults,
    fetchedPages,
    request,
    metadata,
    spatialLandmarkCandidates = [],
  } = args;

  const formattedResults = searchResults
    .map((group) => {
      const hits = group.hits
        .slice(0, 6)
        .map(
          (h, i) =>
            `  ${i + 1}. ${h.title}\n     URL: ${h.link}\n     ${h.snippet}`,
        )
        .join("\n");
      return `Query: "${group.query}"\n${hits || "  (no results)"}`;
    })
    .join("\n\n");

  const usablePages = fetchedPages.filter((p) => !p.error && p.content);
  const formattedPages =
    usablePages.length > 0
      ? usablePages
          .map(
            (p, i) =>
              `--- PAGE ${i + 1} ---\nURL: ${p.url}\nTITLE: ${p.title ?? "(no title)"}\n\n${p.content}`,
          )
          .join("\n\n")
      : "(no page content was fetched)";

  return `=== USER CONTEXT ===
City: ${request.city}
Price range: ${request.priceRange ?? "not specified"}
Additional context: ${request.additionalContext ?? "none"}

=== VIDEO AGE CONTEXT ===
${buildVideoAgeBlock(metadata)}

=== VIDEO METADATA — CAPTION & HASHTAGS (cross-check for explicit locations) ===
Video caption: ${metadata?.caption ?? "(none)"}
Hashtags: ${metadata?.hashtags?.length ? metadata.hashtags.join(", ") : "(none)"}

=== EXTRACTED CLUES ===
${JSON.stringify(clues, null, 2)}
${spatialLandmarkCandidates.length > 0 ? `
=== HIGH-PRIORITY: APARTMENTS NEAR DETECTED LANDMARKS (Places / ~500m) ===
The server geocoded landmark phrase(s) from \`landmarks_spotted\` using Google Places data (via Serper) and matched residential buildings within roughly **500 meters**. These buildings may sit directly next to a visible office tower or named landmark even when their **marketing sites never mention that landmark** — treat each row as a **strong geographic hypothesis**. Verify against tier, view direction, finishes, and pricing from the clues; confirm or reject using WEB SEARCH RESULTS and FETCHED LISTING PAGE CONTENT when possible.

${JSON.stringify(spatialLandmarkCandidates, null, 2)}

When a row plausibly fits the video (same city/submarket, tier, and landmark line-of-sight), rank it **among your top candidates** with appropriately **high confidence** unless evidence contradicts it.
` : ""}
=== WEB SEARCH RESULTS ===
${formattedResults || "(no search results were available)"}

=== FETCHED LISTING PAGE CONTENT ===
The following is the actual text extracted from the most promising listing-site URLs in the search results above. Treat this content as PRIMARY EVIDENCE — it is more authoritative than the search snippets because it comes directly from the listing page. The building name is often in the TITLE or opening lines, but listicles and locator guides frequently name **many** buildings only in the **body** — read the full text.

${formattedPages}

=== IMPORTANT — SCAN ALL FETCHED PAGES FOR BUILDING NAMES ===
Before selecting candidates, you MUST scan ALL fetched listing page content for EVERY apartment building name mentioned. Many fetched pages are listicles, blog posts, or locator guides that mention dozens of buildings by name. Any of those buildings could be the correct match.

EXAMPLE OF WHY THIS MATTERS: In one test case, the clues were: Downtown Austin, luxury high-rise, studios at $1596, 6 weeks free, dark cabinetry, track lighting, floor-to-ceiling windows. A fetched page from tacostreetlocating.com listed 10+ downtown Austin high-rises including one called **Northshore**, described as a super high-end luxury building. Northshore was the correct answer. But the model ignored it because it only considered buildings that appeared in search result titles with matching pricing. Northshore never appeared in any search query result title — it only appeared inside the body text of a fetched page. The analysis missed it completely.

DO THIS EVERY TIME:
- Extract every apartment building name from all fetched page content (titles, headings, bullets, paragraphs — not only the page's main subject).
- For each building found, assess whether its described location, tier, and features could match the video clues.
- If a building is plausible, use search results and fetched evidence to verify pricing and features before ruling it out; do not discard a name just because it was not in a search **title** or snippet.
- NEVER limit your candidates to only buildings that appeared as direct search result titles.

=== NAME ↔ ADDRESS INTEGRITY (FETCHED PAGES & LISTICLES) ===
When extracting building names from fetched pages, **verify that the name and address you assign to each candidate refer to the same building.** Do **not** mix a building name from one entry with an address from another. If a listicle mentions multiple buildings, **match each marketing name to its own address** (and its own URL when the page gives distinct links).

Real-world failure mode: **Skyhouse** is associated with **51 Rainey** (example); **70 Rainey** / **70 Rainey ATX** is a **different** property on Rainey Street. Never label the tower at **70 Rainey** as "Skyhouse" unless the source text explicitly ties that name to that address. Treat similar mix-ups (swapping any two buildings from a roundup) as **critical errors** — fix **name**, **address**, and **website** so they are mutually consistent for one property.

=== TASK ===
Analyze the search results against the extracted clues. For each candidate apartment you find:

1. Name of the apartment building
2. Confidence score (0-100, integer)
3. Evidence FOR this match (what clues align)
4. Evidence AGAINST this match (what doesn't fit)
5. **pros** — exactly **2-3** short bullet strings: practical upsides of choosing this building (location, amenities, value, views, finishes) as they relate to the video clues. Be specific; do not repeat evidence_for verbatim.
6. **cons** — exactly **2-3** short bullet strings: real tradeoffs (noise, price, location friction, older stock, policy quirks) a renter should know. If little is known, infer typical tradeoffs for that submarket — still provide 2-3 items.
7. Direct website URL for the apartment (use the strongest URL from the search results — never fabricate)
8. Approximate address

=== WHAT IS NOT A MATCH (CRITICAL FILTERING RULE) ===
You are looking for the actual apartment building or complex, NOT the original video or the social media post about it.

If a search result is a TikTok, Instagram, YouTube, Facebook, X/Twitter, Reddit, Threads, or any other social media link — even if it shows the same video, the same creator, or discusses the same apartment — that is NOT a match. SKIP IT ENTIRELY. Do not include it as a candidate. Do not list its URL as the "website" for any candidate.

A valid match is one of:
  • The apartment building's own marketing/leasing website (e.g. thebowie.com, 70rainey.com)
  • A listing aggregator page that names the building (apartments.com, zillow.com, apartmentlist.com, rent.com, hotpads.com, trulia.com, padmapper.com)
  • A news article, blog post, or local-publication review that names the building
  • A real estate brokerage page that names the building

URL hosts to ALWAYS reject as the "website" field, even if they appear in the search results:
  ✗ tiktok.com, vm.tiktok.com, vt.tiktok.com
  ✗ instagram.com
  ✗ youtube.com, youtu.be, youtube.com/shorts
  ✗ facebook.com, fb.watch
  ✗ twitter.com, x.com
  ✗ reddit.com (use only as supporting evidence — never as the website)
  ✗ pinterest.com, threads.net, threads.com, snapchat.com

You may still READ a social media result as supporting evidence (e.g. a Reddit thread that names the building) — but the candidate's "website" field must point to the building's own page, a listing site, or a publication, never to the social post itself.

=== HARD LOCATION CONSTRAINTS ===
If **on-screen text overlays**, **caption**, or **hashtags** above explicitly name a specific street, neighborhood, or district (e.g. Rainey St, Uptown, Brickell), any candidate that is **NOT** located on that street or in that neighborhood must be **heavily penalized**. **Reduce confidence by 50 points** for any candidate whose address or documented location does **not** match the stated location (relative to a sensible baseline for that candidate — apply the −50 so the final score stays within 0–100).

A building at **301 West Ave** cannot be a top match when the video explicitly says **Rainey St** — even if it has views of Lady Bird Lake and matching finishes. The stated street/neighborhood is one of the **strongest possible signals** and should **override feature-based matching** when there is a conflict. Put the mismatch in **evidence_against** and reflect the penalty in **confidence** and **reasoning**.

If no street/neighborhood/district is explicitly named in overlays, caption, hashtags, or clues, this rule does not apply.

=== SCORING RULES ===
- When the HIGH-PRIORITY Places/LANDMARK section above is non-empty, treat those apartment names as **primary geographic hypotheses** alongside fetched pages — especially when clues mention corporate offices, towers, or skyline alignment. Downweight heavily when they conflict with **HARD LOCATION CONSTRAINTS** above; otherwise downweight only when tier/location/clues clearly conflict.
- When the FETCHED LISTING PAGE CONTENT names a building that matches the city + clues, that's the strongest possible signal — much stronger than a snippet alone. Use the page TITLE and the first paragraphs to identify the building name; use addresses/prices on the page to corroborate.
- Apply the pricing weight policy from the VIDEO AGE CONTEXT above when scoring.
- Specific overlays from the video (exact prices, exact promos, exact unit types) carry the most weight when the video is recent. When the video is old, weight them down per the policy.
- Location/neighborhood clues, visible landmarks, view direction, and structural features (window style, balcony type, finishes) are ALWAYS strong signals regardless of age.
- A candidate's website/listing must plausibly align with the city. Buildings in the wrong city are immediate disqualifiers.
- If the video age policy classifies pricing as STRONG, a clear pricing band mismatch (e.g. video shows studios at $1596 but listing shows studios from $2400) is a HEAVY penalty — cap that candidate's confidence below 50.
- If the policy classifies pricing as SOFT, a pricing mismatch is a mild penalty (5-15 points) — do not disqualify.
- If the policy says IGNORE pricing, do not include pricing in evidence_for or evidence_against at all.

=== EXACTLY THREE CANDIDATES (MANDATORY) ===
You MUST always return exactly **3** objects in "matches", sorted by confidence descending — even when you are not confident. If you find only 1-2 strong matches, fill the remaining slots with your best educated guesses from the search results (same city, plausible tier/location/view). Assign those padded candidates appropriately **low** confidence (for example 15-35). **Never** return fewer than 3 candidates. **Never** return an empty "matches" array.

For every candidate, you must still follow the social-media URL rules above for the "website" field. For weaker guesses, use the best non-social URL from the evidence that could plausibly relate, or "" if none exists. Never fabricate URLs or addresses; if unsure, use "" for address.

Return JSON exactly matching this schema:
{
  "matches": [
    {
      "name": string,
      "confidence": number,                    // 0-100 integer
      "address": string,
      "website": string,
      "evidence_for": string[],
      "evidence_against": string[],
      "pros": string[],                        // REQUIRED: 2-3 items (see TASK)
      "cons": string[],                        // REQUIRED: 2-3 items (see TASK)
      "reasoning": string                      // 1-2 sentences
    }
  ],                                            // EXACTLY 3, sorted by confidence desc
  "overall_confidence": "high" | "medium" | "low",
  "limiting_factors": string[]                 // what made this search harder
}`;
}

// ---------------------------------------------------------------------------
// Step 5 — Visual verification
// ---------------------------------------------------------------------------

export const VISUAL_VERIFICATION_SYSTEM_PROMPT = `You are an apartment matching expert. You determine whether reference photos (interiors and/or building exteriors) depict the same apartment BUILDING shown in TikTok/Reels tour frames — not necessarily the same floor plan.

IMPORTANT: Apartment buildings have many different floor plans with different finishes. A kitchen with dark cabinets in the video and light cabinets in the listing photos does NOT mean it is a different building — it likely means it is a different unit or floor plan within the same building. Only rate as NO_MATCH when the building EXTERIOR or overall architectural style clearly indicates a different building. Interior finish differences alone should be rated as PARTIAL_MATCH, not NO_MATCH — and use confidence_penalty_bucket "interior_finishes" when finishes clearly differ.

Reserve STRONG_MATCH for cases where multiple distinctive interior elements clearly match OR exterior identity clearly aligns when interiors are sparse — generic luxury-modern similarity alone is NOT enough.

When EXTERIOR reference images are provided, compare facade, massing, balcony rhythm, and distinctive architectural features against any exterior or skyline glimpses in the video.

Return ONLY a single JSON object matching the schema in the user message. Do not wrap it in markdown fences. Do not invent fields.`;

export function buildVisualVerificationUserPrompt(args: {
  match: ApartmentMatch;
  request: AnalyzeRequest;
  videoFrameCount: number;
  interiorPhotoCount: number;
  exteriorPhotoCount: number;
  /** e.g. "candidate website" or "Google Images (interior + exterior)" */
  referencePhotoSource: string;
}): string {
  const {
    match,
    request,
    videoFrameCount,
    interiorPhotoCount,
    exteriorPhotoCount,
    referencePhotoSource,
  } = args;
  const totalRef = interiorPhotoCount + exteriorPhotoCount;
  return `Compare the reference photos below to the original video frames from an apartment tour.

CANDIDATE: ${match.name}
ADDRESS:   ${match.address || "(not provided)"}
WEBSITE:   ${match.website || "(not provided)"}
CITY:      ${request.city}
SEARCH-ONLY CONFIDENCE (before you look): ${match.confidence}%
REFERENCE SOURCE: ${referencePhotoSource}

The first ${videoFrameCount} image(s) below are FRAMES FROM THE ORIGINAL VIDEO (or user screenshots of the same unit).

Then: ${interiorPhotoCount} INTERIOR reference image(s) (kitchen, living, bath, finishes — use these for unit-level matching).

Then: ${exteriorPhotoCount} EXTERIOR / BUILDING reference image(s) (facade, tower, amenity deck if clearly the same property). Use these to check whether the building seen from windows or in outdoor shots in the video could be the same property.

INTERIORS — note differences for evidence, but interpret them charitably across units:
- Cabinet color and style
- Countertop material and color
- Flooring type and color
- Lighting fixtures
- Window style and size
- View from windows
- Ceiling height
- Overall layout

EXTERIORS (when present) — check against any building or skyline visible in the video:
- Tower shape, floor plate, balcony rhythm, crown/spire, cladding color
- Consistency with the neighborhood / landmark context if visible

Rate the visual similarity as exactly ONE of:
- STRONG_MATCH  — multiple distinctive interior elements clearly match the same unit/building identity, OR exterior identity clearly aligns with the video when exteriors are visible — and nothing contradicts same-building.
- PARTIAL_MATCH — plausible same BUILDING but different floor plan/unit or inconclusive interiors; OR interior finishes clearly differ but exterior/tower identity still fits (different unit in same tower).
- NO_MATCH      — use ONLY when the same-building hypothesis is ruled out: e.g. listing tower facade clearly incompatible with visible exterior/skyline in the video, or unmistakably different architectural era/style at the building level. Do NOT use NO_MATCH for cabinet/floor finish differences alone.

confidence_penalty_bucket (REQUIRED — drives downstream scoring):
- "none" — STRONG_MATCH; or PARTIAL_MATCH with only mild uncertainty / matching finishes.
- "interior_finishes" — interiors clearly differ (different finishes/layout vs reference photos) but the BUILDING/tower could still plausibly match — typical different-unit scenario. Use with PARTIAL_MATCH, or with NO_MATCH only if you truly believe NO_MATCH despite exterior ambiguity (prefer PARTIAL_MATCH when unsure).
- "full_building" — ONLY when BOTH (a) exterior OR unmistakable building shell/skyline context is observable in the video AND (b) candidate exterior/reference contradicts that building identity AND (c) interiors also fail to salvage same-building — reserve for genuinely wrong-building candidates.

Be skeptical of STRONG_MATCH — distinctive interior details OR strong exterior alignment should justify it.

Return JSON exactly matching this schema:
{
  "rating": "STRONG_MATCH" | "PARTIAL_MATCH" | "NO_MATCH",
  "confidence_penalty_bucket": "none" | "interior_finishes" | "full_building",
  "reasoning": string,                  // 1-3 sentences justifying the rating and bucket
  "matched_features": string[],         // be concrete: "matching herringbone backsplash", not "kitchens are similar". May be empty.
  "mismatched_features": string[]       // specific interior or exterior elements that clearly differ. May be empty.
}`;
}
