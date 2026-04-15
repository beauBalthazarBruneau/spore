import { NextRequest, NextResponse } from "next/server";
import { patchCompany, getCompany } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  const body = await req.json();
  const allowed = ["ats_source", "ats_slug", "watching", "archived", "domain", "linkedin_url", "notes"] as const;
  const patch: Record<string, unknown> = {};
  for (const k of allowed) if (k in body) patch[k] = body[k];
  const row = patchCompany(id, patch);
  return NextResponse.json(row);
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const row = getCompany(parseInt(params.id, 10));
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}
