import { NextResponse } from "next/server";
import { getApplicationQuestions, saveApplicationQuestion } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = parseInt(id, 10);
  if (isNaN(jobId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  return NextResponse.json(getApplicationQuestions(jobId));
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = parseInt(id, 10);
  if (isNaN(jobId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const body = await req.json();
  const { questionId, answer } = body as { questionId: number; answer: string };
  if (typeof questionId !== "number" || typeof answer !== "string") {
    return NextResponse.json({ error: "questionId and answer required" }, { status: 400 });
  }

  saveApplicationQuestion(questionId, answer);
  return NextResponse.json({ ok: true });
}
