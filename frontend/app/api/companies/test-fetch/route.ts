import { NextRequest, NextResponse } from "next/server";
import { sources } from "../../../../../mcp/sources";

export const dynamic = "force-dynamic";

// Dry-run fetch from an ATS adapter — used by the "test" button when adding a company,
// so wrong slugs are caught before the company is written.
export async function POST(req: NextRequest) {
  const { ats_source, ats_slug } = await req.json();
  if (!ats_source || !ats_slug) {
    return NextResponse.json({ error: "ats_source and ats_slug required" }, { status: 400 });
  }
  const adapter = sources[ats_source];
  if (!adapter) return NextResponse.json({ error: `unknown ats_source: ${ats_source}` }, { status: 400 });

  try {
    const jobs = await adapter.search({ companies: [ats_slug], maxPerCompany: 5 });
    return NextResponse.json({ ok: true, count: jobs.length, sample: jobs.slice(0, 3).map((j) => ({ title: j.title, location: j.location })) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 200 });
  }
}
