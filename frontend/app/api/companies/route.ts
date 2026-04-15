import { NextRequest, NextResponse } from "next/server";
import { listCompanies, upsertCompany } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const includeArchived = searchParams.get("includeArchived") === "1";
  return NextResponse.json(listCompanies({ includeArchived }));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  const row = upsertCompany({
    name: body.name.trim(),
    ats_source: body.ats_source ?? null,
    ats_slug: body.ats_slug ?? null,
    watching: body.watching ? 1 : 0,
    domain: body.domain ?? null,
    linkedin_url: body.linkedin_url ?? null,
    notes: body.notes ?? null,
  });
  return NextResponse.json(row);
}
