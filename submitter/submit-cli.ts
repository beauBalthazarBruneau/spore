/**
 * CLI entry point for submitting a job application.
 * Usage: npx tsx submitter/submit-cli.ts <job_id>
 * Outputs a single JSON line: { success, confirmationRef?, error? }
 */
import { rm } from "node:fs/promises";
import { getDb } from "../backend/db";
import { submitJob } from "./index";
import { resolveProfile } from "./profile";

async function main() {
  const jobId = Number(process.argv[2]);
  if (!jobId) {
    console.log(JSON.stringify({ success: false, error: "job_id required" }));
    process.exit(1);
  }

  const db = getDb();

  const job = db
    .prepare(
      `SELECT j.id, j.url, j.title, j.status, c.ats_source
         FROM jobs j LEFT JOIN companies c ON c.id = j.company_id
        WHERE j.id = ?`,
    )
    .get(jobId) as { id: number; url: string | null; title: string; status: string; ats_source: string | null } | undefined;

  if (!job) {
    console.log(JSON.stringify({ success: false, error: `job ${jobId} not found` }));
    process.exit(0);
  }
  if (job.status !== "ready_to_apply" && job.status !== "submission_failed") {
    console.log(JSON.stringify({ success: false, error: `job ${jobId} is in status '${job.status}', expected 'ready_to_apply' or 'submission_failed'` }));
    process.exit(0);
  }
  if (!job.url) {
    console.log(JSON.stringify({ success: false, error: `job ${jobId} has no URL` }));
    process.exit(0);
  }

  db.prepare(`UPDATE jobs SET status = 'submitting', updated_at = datetime('now') WHERE id = ?`).run(jobId);
  db.prepare(
    `INSERT INTO events (entity_type, entity_id, action, actor, payload_json) VALUES ('job', ?, 'submission_started', 'board', ?)`,
  ).run(jobId, JSON.stringify({ job_id: jobId }));

  let result: { success: boolean; confirmationRef?: string; error?: string };
  let tmpDir: string | null = null;

  try {
    const questions = db
      .prepare(`SELECT id, question, answer, field_type, field_selector FROM application_questions WHERE job_id = ?`)
      .all(jobId) as Array<{ id: number; question: string; answer: string | null; field_type: string | null; field_selector: string | null }>;

    const { profile, tmpDir: td } = await resolveProfile(db, jobId);
    tmpDir = td;

    result = await submitJob({
      jobId,
      url: job.url,
      atsSource: job.ats_source,
      profile,
      questions,
    });
  } catch (e) {
    result = { success: false, error: (e as Error).message };
  } finally {
    if (tmpDir) rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }

  if (result.success) {
    db.prepare(
      `UPDATE jobs SET status = 'applied', submitted_at = datetime('now'), confirmation_ref = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(result.confirmationRef ?? null, jobId);
    db.prepare(
      `INSERT INTO events (entity_type, entity_id, action, actor, payload_json) VALUES ('job', ?, 'submission_completed', 'board', ?)`,
    ).run(jobId, JSON.stringify({ confirmation_ref: result.confirmationRef ?? null }));
  } else {
    db.prepare(`UPDATE jobs SET status = 'submission_failed', updated_at = datetime('now') WHERE id = ?`).run(jobId);
    db.prepare(
      `INSERT INTO events (entity_type, entity_id, action, actor, payload_json) VALUES ('job', ?, 'submission_failed', 'board', ?)`,
    ).run(jobId, JSON.stringify({ error: result.error ?? "unknown error" }));
  }

  console.log(JSON.stringify(result));
}

main().catch((e) => {
  console.log(JSON.stringify({ success: false, error: (e as Error).message }));
  process.exit(1);
});
