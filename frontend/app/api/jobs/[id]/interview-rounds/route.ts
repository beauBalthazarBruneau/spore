import { NextResponse } from "next/server";
import { getInterviewRounds, upsertInterviewRound, deleteInterviewRound } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = parseInt(id, 10);
  if (isNaN(jobId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  return NextResponse.json(getInterviewRounds(jobId));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = parseInt(id, 10);
  if (isNaN(jobId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const body = await req.json();
  const { roundId = null, label = "Round 1", prepMd = "" } = body as { roundId?: number | null; label?: string; prepMd?: string };

  const round = upsertInterviewRound(jobId, roundId, label, prepMd);
  return NextResponse.json(round);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = parseInt(id, 10);
  if (isNaN(jobId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const body = await req.json();
  const { roundId } = body as { roundId: number };
  if (typeof roundId !== "number") return NextResponse.json({ error: "roundId required" }, { status: 400 });

  deleteInterviewRound(roundId, jobId);
  return NextResponse.json({ ok: true });
}
