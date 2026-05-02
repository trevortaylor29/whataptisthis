import type { SpatialLandmarkCandidate } from "./types";
import { SearchError } from "./search";

const SERPER_PLACES_URL = "https://google.serper.dev/places";

/** Default radius for “apartments near this landmark” (meters). */
export const PLACES_NEARBY_RADIUS_M = 500;

/** Max landmark phrases to geocode per request (Serper credits / latency). */
const MAX_LANDMARKS_TO_PROCESS = 3;

/** Max apartment rows we attach to the candidate-analysis prompt (global). */
const MAX_SPATIAL_CANDIDATE_ROWS = 24;

/** Max apartments per landmark after distance filter. */
const MAX_APARTMENTS_PER_LANDMARK = 8;

interface SerperPlaceRow {
  title?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  type?: string;
  types?: string[];
  website?: string;
}

interface SerperPlacesResponse {
  places?: SerperPlaceRow[];
}

export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Turn a vision-model landmark line into a geocoder-friendly query plus city.
 * Strips trailing "visible from …" per clue-extraction format.
 */
export function landmarkPhraseToGeocodeQuery(
  phrase: string,
  city: string,
): string {
  let s = phrase.trim().replace(/\s+/g, " ");
  const vis = /\s+visible from\s+.+/i.exec(s);
  if (vis?.index != null && vis.index > 0) {
    s = s.slice(0, vis.index).trim();
  }
  if (!s) s = phrase.trim();
  return `${s} ${city.trim()}`.replace(/\s+/g, " ").trim();
}

function isEligibleLandmarkPhrase(raw: string): boolean {
  const s = raw.trim();
  if (s.length < 6) return false;
  const lower = s.toLowerCase();
  if (
    /^(the )?(downtown|city)\s+(skyline|view)$/i.test(lower) ||
    lower === "skyline" ||
    lower === "downtown"
  ) {
    return false;
  }
  return true;
}

function isApartmentLikePlace(p: SerperPlaceRow): boolean {
  const title = (p.title ?? "").toLowerCase();
  const blob = [p.type, ...(p.types ?? [])].join(" ").toLowerCase();
  if (
    blob.includes("apartment") ||
    blob.includes("condominium") ||
    blob.includes("housing complex") ||
    blob.includes("residential")
  ) {
    return true;
  }
  if (
    /\b(apartments?|residences|lofts?|condos?|towers?|high-?rise|mid-?rise|luxury rentals?)\b/.test(
      title,
    )
  ) {
    return true;
  }
  if (blob.includes("hotel") && !/\b(extended|residence)\b/.test(blob)) {
    return false;
  }
  if (
    blob.includes("restaurant") ||
    blob.includes("coffee shop") ||
    blob.includes("parking")
  ) {
    return false;
  }
  return false;
}

function dedupeKeyForPlace(p: SerperPlaceRow): string | null {
  const lat = p.latitude;
  const lng = p.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  const title = (p.title ?? "").trim().toLowerCase();
  return `${title}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
}

/**
 * Google Places via Serper (`/places`). Same API key as web search.
 */
export async function runSerperPlacesQuery(
  q: string,
  options?: { num?: number },
): Promise<SerperPlaceRow[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    throw new SearchError(
      "SERPER_API_KEY is not set. Add it to .env.local or set MOCK_OPENROUTER=1 (which also mocks search).",
      500,
    );
  }

  const num = Math.min(50, Math.max(1, options?.num ?? 20));

  const res = await fetch(SERPER_PLACES_URL, {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: q.trim(), num, gl: "us", hl: "en" }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new SearchError(
      `Serper places request failed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`,
      res.status,
    );
  }

  const data = (await res.json()) as SerperPlacesResponse;
  return data.places ?? [];
}

async function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Geocode the landmark phrase; returns the first Places row with coordinates.
 */
async function resolveLandmarkAnchor(
  landmarkSource: string,
  city: string,
): Promise<{
  query: string;
  lat: number;
  lng: number;
  resolvedTitle: string;
} | null> {
  const query = landmarkPhraseToGeocodeQuery(landmarkSource, city);
  const rows = await runSerperPlacesQuery(query, { num: 8 });
  for (const row of rows) {
    const lat = row.latitude;
    const lng = row.longitude;
    if (typeof lat === "number" && typeof lng === "number") {
      return {
        query,
        lat,
        lng,
        resolvedTitle: row.title?.trim() || query,
      };
    }
  }
  return null;
}

/**
 * Pull a city-wide pool of residential POIs, then filter by distance in-memory.
 */
async function fetchCityApartmentPool(city: string): Promise<SerperPlaceRow[]> {
  const seen = new Set<string>();
  const out: SerperPlaceRow[] = [];

  const queries = [
    `luxury apartment buildings ${city}`,
    `apartment complexes ${city}`,
  ];

  for (const q of queries) {
    const rows = await runSerperPlacesQuery(q, { num: 40 });
    for (const row of rows) {
      const key = dedupeKeyForPlace(row);
      if (!key || seen.has(key)) continue;
      if (!isApartmentLikePlace(row)) continue;
      const lat = row.latitude;
      const lng = row.longitude;
      if (typeof lat !== "number" || typeof lng !== "number") continue;
      seen.add(key);
      out.push(row);
    }
    await delay(120);
  }

  return out;
}

/**
 * Fallback when the city pool has little near the anchor: local “near” query.
 */
async function fetchNearLandmarkFallback(
  landmarkTitle: string,
  city: string,
): Promise<SerperPlaceRow[]> {
  const q = `apartments near ${landmarkTitle} ${city}`;
  const rows = await runSerperPlacesQuery(q, { num: 20 });
  return rows.filter((row) => {
    const lat = row.latitude;
    const lng = row.longitude;
    return (
      typeof lat === "number" &&
      typeof lng === "number" &&
      isApartmentLikePlace(row)
    );
  });
}

export interface CollectApartmentsNearLandmarksResult {
  candidates: SpatialLandmarkCandidate[];
  warnings: string[];
}

/**
 * For each distinct landmark from clue extraction: geocode via Serper Places,
 * gather apartment POIs within {@link PLACES_NEARBY_RADIUS_M} using a city-wide
 * Places pool plus optional “apartments near …” fallback.
 */
export async function collectApartmentsNearLandmarks(
  landmarksSpotted: string[],
  city: string,
): Promise<CollectApartmentsNearLandmarksResult> {
  const warnings: string[] = [];
  const phrases = [...new Set(landmarksSpotted.map((s) => s.trim()))].filter(
    isEligibleLandmarkPhrase,
  );

  const toProcess = phrases.slice(0, MAX_LANDMARKS_TO_PROCESS);
  if (toProcess.length === 0) {
    return { candidates: [], warnings };
  }

  const anchors: Array<{
    source: string;
    query: string;
    lat: number;
    lng: number;
    resolvedTitle: string;
  }> = [];

  for (const phrase of toProcess) {
    try {
      const anchor = await resolveLandmarkAnchor(phrase, city);
      if (!anchor) {
        warnings.push(
          `Places geocode returned no coordinates for landmark: ${phrase.slice(0, 80)}`,
        );
        continue;
      }
      anchors.push({
        source: phrase,
        query: anchor.query,
        lat: anchor.lat,
        lng: anchor.lng,
        resolvedTitle: anchor.resolvedTitle,
      });
      await delay(150);
    } catch (e) {
      warnings.push(
        `Places geocode failed (${phrase.slice(0, 60)}): ${(e as Error).message}`,
      );
    }
  }

  if (anchors.length === 0) {
    return { candidates: [], warnings };
  }

  let pool: SerperPlaceRow[] = [];
  try {
    pool = await fetchCityApartmentPool(city);
  } catch (e) {
    warnings.push(
      `Places apartment pool failed: ${(e as Error).message}`,
    );
  }

  const spatialRows: SpatialLandmarkCandidate[] = [];
  const globalSeen = new Set<string>();

  for (const a of anchors) {
    let nearby = pool
      .map((p) => {
        const lat = p.latitude!;
        const lng = p.longitude!;
        const d = haversineMeters(a.lat, a.lng, lat, lng);
        return { p, d };
      })
      .filter(({ d }) => d <= PLACES_NEARBY_RADIUS_M && d > 15)
      .sort((x, y) => x.d - y.d)
      .slice(0, MAX_APARTMENTS_PER_LANDMARK);

    if (nearby.length === 0) {
      try {
        const fb = await fetchNearLandmarkFallback(a.resolvedTitle, city);
        nearby = fb
          .map((p) => {
            const lat = p.latitude!;
            const lng = p.longitude!;
            const d = haversineMeters(a.lat, a.lng, lat, lng);
            return { p, d };
          })
          .filter(({ d }) => d <= PLACES_NEARBY_RADIUS_M && d > 15)
          .sort((x, y) => x.d - y.d)
          .slice(0, MAX_APARTMENTS_PER_LANDMARK);
        await delay(120);
      } catch (e) {
        warnings.push(
          `Places fallback near "${a.resolvedTitle}" failed: ${(e as Error).message}`,
        );
      }
    }

    for (const { p, d } of nearby) {
      const key = dedupeKeyForPlace(p);
      if (!key || globalSeen.has(key)) continue;
      globalSeen.add(key);

      spatialRows.push({
        landmarkSource: a.source,
        landmarkQuery: a.query,
        landmarkLat: a.lat,
        landmarkLng: a.lng,
        landmarkResolvedTitle: a.resolvedTitle,
        apartmentName: (p.title ?? "").trim() || "(unnamed place)",
        distanceMeters: Math.round(d),
        apartmentAddress: p.address?.trim(),
        apartmentWebsite: p.website?.trim(),
        placeTypes: p.types ?? (p.type ? [p.type] : undefined),
      });

      if (spatialRows.length >= MAX_SPATIAL_CANDIDATE_ROWS) break;
    }
    if (spatialRows.length >= MAX_SPATIAL_CANDIDATE_ROWS) break;
  }

  spatialRows.sort((a, b) => a.distanceMeters - b.distanceMeters);

  return {
    candidates: spatialRows.slice(0, MAX_SPATIAL_CANDIDATE_ROWS),
    warnings,
  };
}

/** Mock spatial candidates for MOCK_OPENROUTER dev flows. */
export function buildMockSpatialLandmarkCandidates(
  city: string,
): SpatialLandmarkCandidate[] {
  const c = city.trim() || "Austin, TX";
  return [
    {
      landmarkSource: "Indeed Tower visible from living room",
      landmarkQuery: `Indeed Tower ${c}`,
      landmarkLat: 30.26685,
      landmarkLng: -97.74279,
      landmarkResolvedTitle: "Indeed Tower",
      apartmentName: "The Bowie",
      distanceMeters: 210,
      apartmentAddress: "1717 W 6th St, Austin, TX",
      apartmentWebsite: "",
      placeTypes: ["Apartment building"],
    },
    {
      landmarkSource: "Indeed Tower visible from living room",
      landmarkQuery: `Indeed Tower ${c}`,
      landmarkLat: 30.26685,
      landmarkLng: -97.74279,
      landmarkResolvedTitle: "Indeed Tower",
      apartmentName: "505 Rio",
      distanceMeters: 340,
      apartmentAddress: "505 W Rio Grande St, Austin, TX",
      apartmentWebsite: "",
      placeTypes: ["Apartment building"],
    },
  ];
}
