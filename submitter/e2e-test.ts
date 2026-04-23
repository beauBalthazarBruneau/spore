/**
 * End-to-end test: run a real submission attempt on a low-score Greenhouse job.
 * Uses the production DB; migrates schema if needed; inserts a minimal resume PDF.
 * Expected result: { success: false, error: "Blocked by reCAPTCHA" } for Greenhouse.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { getDb } from "../backend/db";

const FAKE_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n190\n%%EOF",
);

const REPO_ROOT = resolve(process.cwd());

// Low-score Greenhouse job with a direct boards URL
const TEST_JOB_URL = "https://job-boards.greenhouse.io/airtable/jobs/8245333002";

async function main() {
  console.log("=== Spore Submitter E2E Test ===\n");

  const db = getDb();

  // 1. Ensure profile has resume_pdf column (migration may not have run yet)
  const profCols = (db.prepare("PRAGMA table_info(profile)").all() as Array<{ name: string }>).map(c => c.name);
  if (!profCols.includes("resume_pdf")) {
    console.log("Migrating: adding resume_pdf columns to profile...");
    db.exec(`ALTER TABLE profile ADD COLUMN resume_pdf BLOB`);
    db.exec(`ALTER TABLE profile ADD COLUMN resume_pdf_mime TEXT`);
    db.exec(`ALTER TABLE profile ADD COLUMN cover_letter_pdf BLOB`);
    db.exec(`ALTER TABLE profile ADD COLUMN cover_letter_pdf_mime TEXT`);
  }

  // 2. Insert fake resume PDF if not present
  const profile = db.prepare("SELECT id, resume_pdf FROM profile WHERE id = 1").get() as { id: number; resume_pdf: Buffer | null } | undefined;
  if (!profile) {
    console.error("No profile row found. Set up profile first.");
    process.exit(1);
  }
  if (!profile.resume_pdf) {
    console.log("Inserting fake resume PDF into profile...");
    db.prepare("UPDATE profile SET resume_pdf = ?, resume_pdf_mime = ? WHERE id = 1").run(FAKE_PDF, "application/pdf");
  } else {
    console.log("Profile already has resume PDF.");
  }

  // 3. Find or create a ready_to_apply job
  const existing = db.prepare(`
    SELECT j.id, j.title, c.name as company, j.url, j.score, j.status, c.ats_source
    FROM jobs j LEFT JOIN companies c ON c.id = j.company_id
    WHERE j.url = ? LIMIT 1
  `).get(TEST_JOB_URL) as { id: number; title: string; company: string; url: string; score: number; status: string; ats_source: string } | undefined;

  if (!existing) {
    console.error(`Test job not found in DB: ${TEST_JOB_URL}`);
    process.exit(1);
  }

  console.log(`Target job: [${existing.id}] ${existing.title} @ ${existing.company} (score: ${existing.score}, status: ${existing.status})`);

  // 4. Set status to ready_to_apply and inject fake resume PDF on the job
  const jobCols = (db.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>).map(c => c.name);
  if (!jobCols.includes("resume_pdf")) {
    db.exec(`ALTER TABLE jobs ADD COLUMN resume_pdf BLOB`);
    db.exec(`ALTER TABLE jobs ADD COLUMN resume_pdf_mime TEXT`);
    db.exec(`ALTER TABLE jobs ADD COLUMN cover_letter_pdf BLOB`);
    db.exec(`ALTER TABLE jobs ADD COLUMN cover_letter_pdf_mime TEXT`);
  }
  db.prepare(`UPDATE jobs SET status = 'ready_to_apply', resume_pdf = ?, resume_pdf_mime = ?, updated_at = datetime('now') WHERE id = ?`).run(FAKE_PDF, "application/pdf", existing.id);
  console.log(`Status set to ready_to_apply; fake resume PDF injected.\n`);

  // 5. Run submit-cli.ts
  console.log(`Running submit-cli for job ${existing.id}...`);
  let stdout = "";
  try {
    stdout = execFileSync("npx", ["tsx", "submitter/submit-cli.ts", String(existing.id)], {
      cwd: REPO_ROOT,
      timeout: 120_000,
      encoding: "utf8",
    });
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    stdout = err.stdout ?? "";
    console.error("CLI error:", err.message);
    if (err.stderr) console.error("stderr:", err.stderr.slice(0, 500));
  }

  const lastLine = stdout.trim().split("\n").pop() ?? "";
  let result: { success: boolean; confirmationRef?: string; error?: string } = { success: false, error: "no output" };
  try {
    result = JSON.parse(lastLine);
  } catch {
    result = { success: false, error: `Could not parse CLI output: ${lastLine.slice(0, 200)}` };
  }

  console.log("\n=== RESULT ===");
  console.log(JSON.stringify(result, null, 2));

  // 6. Verify final DB status
  const finalJob = db.prepare("SELECT status FROM jobs WHERE id = ?").get(existing.id) as { status: string };
  console.log(`\nFinal DB status: ${finalJob.status}`);
  console.log("\n=== TEST COMPLETE ===");
}

main().catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
