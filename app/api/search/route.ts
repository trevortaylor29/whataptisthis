import { NextRequest, NextResponse } from "next/server";
import { buildMockSearchResults, runSearches } from "@/lib/search";
import { mockEnabled } from "@/lib/openrouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { queries?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Body must be JSON: { queries: string[] }" },
      { status: 400 },
    );
  }

  if (
    !Array.isArray(body.queries) ||
    !body.queries.every((q) => typeof q === "string")
  ) {
    return NextResponse.json(
      { ok: false, error: "`queries` must be an array of strings." },
      { status: 400 },
    );
  }

  const queries = body.queries as string[];
  const results = mockEnabled()
    ? buildMockSearchResults(queries)
    : await runSearches(queries, 7);

  return NextResponse.json({ ok: true, results });
}
