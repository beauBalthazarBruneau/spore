import { NextRequest, NextResponse } from "next/server";
import { getJob, updateJob } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const job = getJob(Number(params.id));
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(job);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const job = updateJob(Number(params.id), body);
  return NextResponse.json(job);
}
