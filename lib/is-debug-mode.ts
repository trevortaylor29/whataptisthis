/**
 * Whether the URL enables pipeline debug UI (?debug=true, ?debug=1, case-insensitive).
 */
export function isDebugModeFromSearchParams(
  params: { get: (name: string) => string | null },
): boolean {
  const raw = params.get("debug");
  if (raw === null || raw === "") return false;
  const v = raw.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}
