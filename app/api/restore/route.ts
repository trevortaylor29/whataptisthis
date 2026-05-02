import { NextRequest, NextResponse } from "next/server";
import { restoreCreditsByEmail } from "@/lib/visitor-db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
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
    return NextResponse.json({ error: "fingerprint is required" }, { status: 400 });
  }

  try {
    const result = await restoreCreditsByEmail(email, fingerprint);
    if (!result.restored) {
      return NextResponse.json({ restored: false });
    }
    return NextResponse.json({
      restored: true,
      credits: result.credits,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Restore failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
