import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/lib/request-ip";
import {
  assertRestoreAllowed,
  recordRestoreFailure,
  recordRestoreSuccess,
} from "@/lib/restore-rate-limit";
import { restoreCreditsByEmail } from "@/lib/visitor-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const gate = await assertRestoreAllowed(ip);
  if (!gate.ok) {
    return NextResponse.json(
      {
        error: "rate_limited",
        blockedUntil: gate.blockedUntil.toISOString(),
      },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rec = body as Record<string, unknown>;
  const email = typeof rec.email === "string" ? rec.email.trim() : "";
  const fingerprint =
    typeof rec.fingerprint === "string" ? rec.fingerprint.trim() : "";

  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }
  if (!fingerprint) {
    return NextResponse.json(
      { error: "fingerprint is required" },
      { status: 400 },
    );
  }

  try {
    const result = await restoreCreditsByEmail(email, fingerprint);
    if (!result.restored) {
      await recordRestoreFailure(ip);
      return NextResponse.json({ restored: false });
    }
    await recordRestoreSuccess(ip);
    return NextResponse.json({
      restored: true,
      credits: result.credits,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Restore failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
