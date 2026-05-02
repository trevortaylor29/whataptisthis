import type {
  ConfidencePenaltyBucket,
  VisualVerificationStatus,
} from "./types";

/**
 * Normalize and validate `confidence_penalty_bucket` from model JSON.
 */
export function normalizeConfidencePenaltyBucket(
  rating: Exclude<VisualVerificationStatus, "UNVERIFIED">,
  raw: unknown,
): ConfidencePenaltyBucket {
  if (rating === "STRONG_MATCH") return "none";

  const s =
    typeof raw === "string"
      ? raw.trim().toLowerCase().replace(/-/g, "_")
      : "";

  if (
    s === "full_building" ||
    s === "building" ||
    s === "full_building_mismatch"
  )
    return "full_building";
  if (
    s === "interior_finishes" ||
    s === "interior_finishes_only" ||
    s === "interior_only"
  )
    return "interior_finishes";
  if (s === "none") return "none";

  // Legacy / safer defaults — NO_MATCH without explicit full_building is softer.
  if (rating === "NO_MATCH") return "interior_finishes";
  return "none";
}

/** Signed delta applied to search-only confidence (negative = penalty). */
export function verificationConfidenceAdjustment(
  rating: VisualVerificationStatus,
  bucket: ConfidencePenaltyBucket,
): number {
  if (rating === "UNVERIFIED") return 0;
  switch (rating) {
    case "STRONG_MATCH":
      return 10;
    case "PARTIAL_MATCH":
      return bucket === "interior_finishes" ? -10 : 0;
    case "NO_MATCH":
      return bucket === "full_building" ? -25 : -10;
    default:
      return 0;
  }
}

/**
 * Applies STRONG_MATCH (+10), interior-finishes penalties (−10), or full-building NO_MATCH (−25).
 */
export function adjustConfidence(
  original: number,
  rating: VisualVerificationStatus,
  bucket: ConfidencePenaltyBucket = "none",
): number {
  if (!Number.isFinite(original)) return original;
  if (rating === "UNVERIFIED") return original;
  const d = verificationConfidenceAdjustment(rating, bucket);
  if (d > 0) return Math.min(99, original + d);
  return Math.max(0, original + d);
}
