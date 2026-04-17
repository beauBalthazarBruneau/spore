import { NextRequest, NextResponse } from "next/server";
import { getProfile, getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getProfile());
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const db = getDb();
  db.prepare(`
    UPDATE profile SET
      full_name = COALESCE(@full_name, full_name),
      email = COALESCE(@email, email),
      phone = COALESCE(@phone, phone),
      location = COALESCE(@location, location),
      links_json = COALESCE(@links_json, links_json),
      base_resume_md = COALESCE(@base_resume_md, base_resume_md),
      preferences_json = COALESCE(@preferences_json, preferences_json),
      criteria_json = COALESCE(@criteria_json, criteria_json),
      updated_at = datetime('now')
    WHERE id = 1
  `).run({
    full_name: body.full_name ?? null,
    email: body.email ?? null,
    phone: body.phone ?? null,
    location: body.location ?? null,
    links_json: body.links_json ? JSON.stringify(body.links_json) : null,
    base_resume_md: body.base_resume_md ?? null,
    preferences_json: body.preferences_json ? JSON.stringify(body.preferences_json) : null,
    criteria_json: body.criteria_json ? JSON.stringify(body.criteria_json) : null,
  });
  return NextResponse.json(getProfile());
}
