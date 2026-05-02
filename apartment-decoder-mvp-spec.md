# Apartment Video Decoder — MVP Prototype Spec

## What This Is

A single-page web app that identifies apartments from gatekept TikTok/Instagram videos. Users paste a link or upload screenshots, the AI extracts clues, searches the web, and returns its best guesses for which apartment building it is.

This is a **prototype to test feasibility.** No accounts, no payments, no database, no cache. Just: can this thing actually identify apartments?

---

## Tech Stack

- **Frontend:** Next.js 14+ (App Router), Tailwind CSS
- **Backend:** Next.js API routes
- **AI:** OpenRouter API (use DeepSeek V4 Flash for cheap reasoning, fallback to Claude Sonnet only if needed)
- **Web Search:** OpenRouter with a model that supports tool use + web search, OR use Serper.dev API ($50/mo for 50k searches) as a dedicated search layer
- **Video/Screenshot Processing:** Use a TikTok scraper library (like `@scraper/tiktok` or similar) to extract video metadata (caption, hashtags, description). For screenshots, send directly to vision model.
- **OCR:** Use the AI vision model itself — send frames/screenshots and ask it to read all visible text. No separate OCR service needed for MVP.

---

## User Flow

```
1. User lands on page
2. User either:
   a. Pastes a TikTok/Instagram link
   b. Uploads 1-3 screenshots from the video
3. User provides:
   - City (required — dropdown or text input)
   - Price range (optional)
   - Any other clues they know (optional text field, e.g. "across from Indeed Tower")
4. User clicks "Find This Apartment"
5. Loading state with progress indicators (see below)
6. Results page shows top 1-3 guesses with confidence + reasoning
```

---

## Architecture / API Flow

### Step 1: Input Processing

**If TikTok link:**
- Server-side: extract video metadata (caption, hashtags, description, creator name)
- Extract 5-8 key frames from the video at even intervals
- If link extraction fails, prompt user to upload screenshots instead

**If screenshots:**
- Accept 1-3 images (jpg, png, webp)
- Send directly to vision model

### Step 2: Clue Extraction

**IMPORTANT: On-screen text overlays are the #1 signal.** Most TikTok/Reels apartment videos have creator-added text overlays showing city, price, unit type, and specials (e.g. "DOWNTOWN AUSTIN — studios start at $1596 — 6 weeks free"). These overlays appear burned into the video frames and are readable via vision/OCR on extracted frames or uploaded screenshots. This single signal source, combined with web search, will identify the apartment more often than any visual matching. Prioritize frame selection to capture moments where text overlays are visible.

Send frames/screenshots + any text metadata to the AI with this prompt structure:

```
SYSTEM PROMPT:
You are an apartment identification expert. You analyze TikTok/Instagram apartment tour videos to identify which specific apartment building is being shown.

Given the following evidence from an apartment video, extract every possible identifying clue.

USER PROMPT:
City: {user_provided_city}
Price range: {user_provided_price OR "not specified"}
Additional context from user: {user_provided_clues OR "none"}

Video caption: {extracted_caption OR "not available"}
Hashtags: {extracted_hashtags OR "not available"}
Creator: {creator_username OR "not available"}

[Attached: screenshots/frames from the video]

TASK (in priority order):
1. **#1 PRIORITY — ON-SCREEN TEXT OVERLAYS:** TikTok/Reels creators almost always add text overlays directly on the video with info like city, price, unit type, move-in specials, neighborhood name. Read ALL of these first. This is your single most valuable signal. Examples: "DOWNTOWN AUSTIN", "studios start at $1596", "offering 6 weeks free", "2BR/2BA starting at $2,400"
2. Read ALL other visible text in every image (signs, logos, building names, street signs, nearby business names, anything on walls/doors/elevators)
3. Identify any recognizable landmarks or buildings visible through windows or in the background
4. Note the style/tier of the apartment (luxury high-rise, mid-range garden style, etc.)
5. Note specific features (floor-to-ceiling windows, balcony type, pool visible, specific finishes)
6. Estimate which floor/height based on the view
7. Note any neighborhood clues

Return a structured JSON:
{
  "onscreen_text_overlays": ["list of all creator-added text overlays — city, price, unit type, specials, neighborhood"],
  "other_visible_text": ["list of all other text read from images — signs, logos, building names, street signs, business names"],
  "landmarks_spotted": ["list of any recognized buildings/landmarks"],
  "view_direction": "description of what's visible from windows",
  "apartment_tier": "luxury/mid-range/budget",
  "notable_features": ["list of distinctive features"],
  "estimated_floor": "low/mid/high-rise estimate",
  "neighborhood_clues": ["any neighborhood indicators"],
  "price_clues": "any pricing mentioned in caption/video",
  "search_queries": [
    "3-5 suggested Google search queries to find this apartment"
  ]
}
```

### Step 3: Web Search

Take the AI's suggested search queries and run them. Also construct your own queries from the clues:

```
"{city} apartment {price_range} {landmark} {notable_feature}"
"{city} luxury apartment near {landmark}"
"{visible_text_from_sign} {city} apartment"
"{creator_username} apartment tour {city}" (sometimes the creator tags the building in other posts)
```

Run 3-5 search queries via Serper.dev or equivalent. Collect the top results.

### Step 4: Candidate Analysis

Send the search results + original clues back to the AI:

```
SYSTEM PROMPT:
You are an apartment identification expert. Based on clues extracted from a TikTok apartment video and web search results, determine which apartment building is most likely shown in the video.

USER PROMPT:
=== EXTRACTED CLUES ===
{clue_extraction_json from Step 2}

=== WEB SEARCH RESULTS ===
{search results with titles, snippets, URLs}

=== TASK ===
Analyze the search results against the extracted clues. For each candidate apartment you find:

1. Name of the apartment building
2. Confidence score (0-100%)
3. Evidence FOR this match (what clues align)
4. Evidence AGAINST this match (what doesn't fit)
5. Direct website URL for the apartment
6. Approximate address

Return top 3 candidates as JSON:
{
  "matches": [
    {
      "name": "The Bowie",
      "confidence": 87,
      "address": "315 Bowie St, Austin, TX 78703",
      "website": "https://...",
      "evidence_for": [
        "Indeed Tower visible from upper floors facing east",
        "Price range matches ($2,200-2,600 for 1BR)",
        "Floor-to-ceiling windows match listing photos"
      ],
      "evidence_against": [
        "Cabinet style in video appears slightly different from listing photos"
      ],
      "reasoning": "Brief explanation of why this is the top match"
    }
  ],
  "overall_confidence": "high/medium/low",
  "limiting_factors": ["what made this search harder"]
}
```

### Step 5: Display Results

Show the results in a clean UI (see Frontend section below).

---

## Frontend Design

### Design Direction

**Aesthetic: Modern detective/investigator tool.** Think clean, dark UI with sharp accents. Not gamified, not cutesy. It should feel like a smart tool that does real work. Inspired by things like Linear, Vercel dashboard — but with a slightly warmer, more approachable tone since users are apartment hunters, not developers.

### Page Structure

**Single page app with states:**

#### State 1: Input
- Hero headline: "Find Any Apartment From a TikTok" (or similar — punchy, clear)
- Subheadline: "Paste a link or upload screenshots. We'll identify the building."
- Input area:
  - Tab toggle: "Paste Link" | "Upload Screenshots"
  - Link tab: single URL input field
  - Screenshot tab: drag-and-drop zone for 1-3 images, with preview thumbnails
  - City input (required): text field with autocomplete for major US cities
  - Price range (optional): simple dropdown ($1,000-1,500 / $1,500-2,000 / $2,000-2,500 / $2,500-3,000 / $3,000+)
  - "Any other clues?" (optional): text field, placeholder: "e.g. across from the Indeed building, has a rooftop pool"
  - Big CTA button: "Find This Apartment"

#### State 2: Processing
- Show a step-by-step progress indicator so the user knows it's working:
  - "Extracting video clues..." ✓
  - "Reading visible text and landmarks..." ✓
  - "Searching apartment listings..." (spinning)
  - "Analyzing candidates..."
  - "Building results..."
- This is important for UX — the search takes 10-30 seconds. Without progress, users will think it's broken.

#### State 3: Results
- Top match displayed prominently:
  - Building name (large)
  - Confidence badge: "87% match"
  - Address
  - "Visit Website →" button (links to apartment's actual site)
  - Evidence section: why we think this is the match (collapsible)
- Runner-up matches (2-3) shown below in smaller cards
- "Not right? Help us improve" link (for future feedback system)
- "Search another" button to reset

#### State 4: Error / Low Confidence
- If confidence is below 40% on all matches:
  - "We couldn't confidently identify this apartment."
  - Show what clues were found
  - Suggest: "Try uploading clearer screenshots" or "Add more context clues"

### Responsive
- Mobile-first. Most users will be coming from TikTok on their phones.
- The input area and results must work perfectly on mobile.

---

## Cost Control for Prototype

This is just a prototype, but still be smart:

- Use DeepSeek V4 Flash ($0.14/$0.28 per million tokens) for all AI calls via OpenRouter
- Only upgrade to Claude Sonnet if DeepSeek results are bad during testing
- Limit to 5 web search queries per request
- Limit uploaded screenshots to 3 max
- If using TikTok link, extract max 6 frames
- Add a simple rate limit: max 10 searches per IP per day (just an in-memory counter for now)
- Estimated cost per search: $0.02-0.05
- Budget for testing phase: ~$20-50 total

---

## OpenRouter Setup

```javascript
// Base API call structure
const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "deepseek/deepseek-v4-flash", // cheap and capable
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    max_tokens: 2000,
  })
});
```

For vision (analyzing screenshots), use a vision-capable model:
```javascript
// For screenshot analysis, need a vision model
// DeepSeek V4 Flash supports vision, otherwise use:
model: "anthropic/claude-sonnet-4-20250514" // more expensive but reliable vision
```

Check OpenRouter docs for current vision-capable model availability and pricing at time of build.

---

## Environment Variables

```
OPENROUTER_API_KEY=your_key_here
SERPER_API_KEY=your_key_here (if using Serper for web search)
```

---

## What This Prototype Does NOT Include

- No user accounts / auth
- No database / caching
- No payment processing
- No feedback system (just a placeholder link)
- No TikTok comment scraping
- No advanced vision matching (skyline comparison, interior matching)
- No "cheaper alternatives" recommendations
- No saved searches
- No ads

All of that comes later IF the prototype proves the core concept works.

---

## Success Criteria

The prototype is successful if:
1. Given a TikTok apartment video from a major city, it correctly identifies the building at least 50-60% of the time
2. Results return in under 30 seconds
3. The confidence scores are roughly calibrated (high confidence = usually right, low confidence = honestly uncertain)
4. It works on mobile

---

## File Structure (Suggested)

```
apartment-decoder/
├── app/
│   ├── page.tsx              # Main page with input/results states
│   ├── layout.tsx            # App layout
│   ├── globals.css           # Global styles + Tailwind
│   └── api/
│       ├── analyze/
│       │   └── route.ts      # Main analysis endpoint
│       ├── extract-tiktok/
│       │   └── route.ts      # TikTok metadata + frame extraction
│       └── search/
│           └── route.ts      # Web search wrapper
├── components/
│   ├── InputForm.tsx         # Link/screenshot input form
│   ├── ProcessingView.tsx    # Loading state with progress steps
│   ├── ResultsView.tsx       # Results display
│   ├── MatchCard.tsx         # Individual apartment match card
│   └── ConfidenceBadge.tsx   # Confidence score display
├── lib/
│   ├── openrouter.ts         # OpenRouter API wrapper
│   ├── tiktok.ts             # TikTok link processing
│   ├── search.ts             # Web search logic
│   └── prompts.ts            # AI prompt templates
├── .env.local
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── next.config.js
```

---

## First Thing To Build

Start with the API route (`/api/analyze`). Hardcode a test case:
- Manually grab a TikTok apartment caption + 2 screenshots from a known Austin apartment
- Send it through the full pipeline
- See if the AI can identify it

If that works with a known answer, you have proof of concept. Then build the frontend around it.
