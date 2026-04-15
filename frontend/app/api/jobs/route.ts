import { NextRequest, NextResponse } from "next/server";
import { listJobs, JobStatus } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.getAll("status") as JobStatus[];
  const jobs = listJobs(status.length ? status : undefined);
  return NextResponse.json(jobs);
}
