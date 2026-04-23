import Database from "better-sqlite3";
import { renderPdf, jsonToTex } from "./resume";

async function main() {
  const jobId = Number(process.argv[2]);
  const db = new Database(process.env.AUTOAPPLY_DB ?? "data/autoapply.db");
  const job = db.prepare("SELECT resume_json FROM jobs WHERE id = ?").get(jobId) as { resume_json: string };
  if (!job?.resume_json) throw new Error(`No resume_json for job ${jobId}`);

  const resumeJson = JSON.parse(job.resume_json);
  const tex = jsonToTex(resumeJson);
  const pdf = await renderPdf(tex);
  db.prepare("UPDATE jobs SET resume_pdf = ?, resume_tex = ?, resume_pdf_mime = ? WHERE id = ?").run(pdf, tex, "application/pdf", jobId);
  console.log(`Re-rendered job ${jobId} — PDF size: ${pdf.length} bytes`);
  db.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
