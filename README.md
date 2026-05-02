# Apartment Decoder (MVP Prototype)

Identify apartments from gatekept TikTok/Instagram videos. Paste a link or
upload screenshots; the AI extracts clues, searches the web, and returns its
best guesses for which building it is.

See [`apartment-decoder-mvp-spec.md`](./apartment-decoder-mvp-spec.md) for the
full product spec.

> **Status:** Backend pipeline (`/api/analyze`) is built. Frontend is a
> placeholder until the API is validated end-to-end.

---

## Setup

```powershell
npm install
Copy-Item .env.local.example .env.local
# then edit .env.local with your keys
```

You need:

- `OPENROUTER_API_KEY` — https://openrouter.ai
- `SERPER_API_KEY` — https://serper.dev (optional if you only run mock tests)

Pick model slugs that exist on OpenRouter when you build:

- `OPENROUTER_VISION_MODEL` (default `google/gemini-2.5-flash`) — used to read
  on-screen text overlays from screenshots/frames.
- `OPENROUTER_REASONING_MODEL` (default `anthropic/claude-sonnet-4-20250514`) —
  used for **candidate analysis / ranking** (clues + search + fetched pages).
  Override with a cheaper model only if you accept weaker ranking tradeoffs.

## Run

```powershell
npm run dev
# open http://localhost:3000
```

## Test the analysis pipeline (no UI required)

The hardcoded test case from the spec (a downtown Austin luxury high-rise) is
in `scripts/test-analyze.ts`.

**Mock mode (no keys required, ~instant):**

```powershell
$env:MOCK_OPENROUTER="1"
npm run test:analyze
```

This proves the request validation, routing, and response shape are correct.

**Live mode (real API calls, ~10-30s):**

```powershell
$env:MOCK_OPENROUTER="0"
$env:OPENROUTER_API_KEY="sk-or-..."
$env:SERPER_API_KEY="..."
npm run test:analyze
```

This is the real feasibility check from the spec — does the AI actually
identify the building?

## API

### `POST /api/analyze`

```jsonc
{
  "city": "Austin, TX",            // required
  "priceRange": "1500-2000",       // optional
  "additionalContext": "...",      // optional
  "tiktokUrl": "https://...",      // either tiktokUrl OR screenshots required
  "screenshots": ["data:image/jpeg;base64,..."]   // 1-3 max, data URLs
}
```

Returns:

```jsonc
{
  "ok": true,
  "city": "Austin, TX",
  "videoMetadata": { /* caption, hashtags, creator, ... */ },
  "clues": { /* see ClueExtraction in lib/types.ts */ },
  "searchResults": [{ "query": "...", "hits": [...] }],
  "analysis": {
    "matches": [{ "name": "The Bowie", "confidence": 86, ... }],
    "overall_confidence": "high",
    "limiting_factors": []
  },
  "timings": { "total_ms": 12345, ... },
  "warnings": []
}
```

### `POST /api/extract-tiktok`

`{ url }` → `{ metadata }` — best-effort TikTok oEmbed lookup.

### `POST /api/search`

`{ queries: string[] }` → `{ results }` — Serper.dev passthrough.

## Project layout

```
apartment-decoder/
├── app/
│   ├── api/
│   │   ├── analyze/route.ts        # ⭐ main pipeline
│   │   ├── extract-tiktok/route.ts
│   │   └── search/route.ts
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx                    # placeholder until UI ships
├── lib/
│   ├── openrouter.ts               # OpenRouter wrapper + JSON extractor + mocks
│   ├── prompts.ts                  # AI prompt templates
│   ├── search.ts                   # Serper wrapper
│   ├── tiktok.ts                   # oEmbed metadata extraction
│   └── types.ts
├── scripts/
│   └── test-analyze.ts             # hardcoded end-to-end test
└── apartment-decoder-mvp-spec.md
```
