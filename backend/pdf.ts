import type Database from "better-sqlite3";
import { mdToPdf } from "md-to-pdf";

/** Render a markdown string to a PDF Buffer. */
export async function renderPdf(markdown: string): Promise<Buffer> {
  const pdf = await mdToPdf({ content: markdown }, { launch_options: { args: ["--no-sandbox"] } });
  if (!pdf || !pdf.content) {
    throw new Error("md-to-pdf returned empty content");
  }
  return pdf.content;
}

/**
 * Read resume_md and cover_letter_md from the job row, render each to PDF,
 * write BLOBs back to the DB, and log a pdf_rendered event.
 */
export async function renderJobPdfs(
  db: Database.Database,
  jobId: number,
): Promise<{ resume_bytes: number; cover_letter_bytes: number }> {
  const job = db
    .prepare(`SELECT resume_md, cover_letter_md FROM jobs WHERE id = ?`)
    .get(jobId) as { resume_md: string | null; cover_letter_md: string | null } | undefined;

  if (!job) throw new Error(`job ${jobId} not found`);
  if (!job.resume_md) throw new Error(`job ${jobId} has no resume_md`);
  if (!job.cover_letter_md) throw new Error(`job ${jobId} has no cover_letter_md`);

  const start = Date.now();

  const [resumeBuf, coverBuf] = await Promise.all([
    renderPdf(job.resume_md),
    renderPdf(job.cover_letter_md),
  ]);

  const duration_ms = Date.now() - start;
  const resume_bytes = resumeBuf.length;
  const cover_letter_bytes = coverBuf.length;

  db.prepare(
    `UPDATE jobs
        SET resume_pdf = ?, resume_pdf_mime = 'application/pdf',
            cover_letter_pdf = ?, cover_letter_pdf_mime = 'application/pdf',
            updated_at = datetime('now')
      WHERE id = ?`,
  ).run(resumeBuf, coverBuf, jobId);

  db.prepare(
    `INSERT INTO events (entity_type, entity_id, action, actor, payload_json)
     VALUES ('job', ?, 'pdf_rendered', 'system', ?)`,
  ).run(jobId, JSON.stringify({ resume_bytes, cover_letter_bytes, duration_ms }));

  return { resume_bytes, cover_letter_bytes };
}
