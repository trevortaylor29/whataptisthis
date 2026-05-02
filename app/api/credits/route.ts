import { NextRequest, NextResponse } from "next/server";
import { getCreditsSnapshot } from "@/lib/visitor-db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const fingerprint =
    req.nextUrl.searchParams.get("visitorId") ??
    req.nextUrl.searchParams.get("fingerprint") ??
    "";

  const snapshot = await getCreditsSnapshot(
    fingerprint.length > 0 ? fingerprint : undefined,
  );

  return NextResponse.json({
    freeScansRemaining: snapshot.freeScansRemaining,
    paidCredits: snapshot.paidCredits,
    scanTier: snapshot.scanTier,
  });
}
