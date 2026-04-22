import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

type PdfType = "resume" | "cover_letter";

const VALID_TYPES: PdfType[] = ["resume", "cover_letter"];

const COLUMN_MAP: Record<PdfType, { blob: string; mime: string; filename: string }> = {
  resume: {
    blob: "resume_pdf",
    mime: "resume_pdf_mime",
    filename: "resume.pdf",
  },
  cover_letter: {
    blob: "cover_letter_pdf",
    mime: "cover_letter_pdf_mime",
    filename: "cover_letter.pdf",
  },
};

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const type = req.nextUrl.searchParams.get("type") as PdfType | null;

  if (!type || !VALID_TYPES.includes(type)) {
    return NextResponse.json(
      { error: "type param must be 'resume' or 'cover_letter'" },
      { status: 400 },
    );
  }

  const { blob: blobCol, mime: mimeCol, filename } = COLUMN_MAP[type];
  const jobId = Number(params.id);

  const db = getDb();
  const row = db
    .prepare(`SELECT ${blobCol}, ${mimeCol} FROM jobs WHERE id = ?`)
    .get(jobId) as Record<string, Buffer | string | null> | undefined;

  if (!row) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const pdfBuffer = row[blobCol] as Buffer | null;
  if (!pdfBuffer) {
    return NextResponse.json({ error: "PDF not yet rendered" }, { status: 404 });
  }

  const contentType = (row[mimeCol] as string | null) ?? "application/pdf";

  return new NextResponse(pdfBuffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${filename}"`,
      "Content-Length": String(pdfBuffer.length),
    },
  });
}
