import type { NextRequest } from "next/server";

/** Client IP for rate limiting (first X-Forwarded-For hop when behind a proxy). */
export function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
