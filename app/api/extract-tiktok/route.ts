import { NextRequest, NextResponse } from "next/server";
import { extractVideoMetadata } from "@/lib/tiktok";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { url?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Body must be JSON: { url: string }" },
      { status: 400 },
    );
  }

  if (typeof body.url !== "string" || body.url.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: "`url` (string) is required." },
      { status: 400 },
    );
  }

  const metadata = await extractVideoMetadata(body.url.trim());
  return NextResponse.json({ ok: true, metadata });
}
