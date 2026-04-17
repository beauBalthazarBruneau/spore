/**
 * Pulls postings + applications out of the resume_bank sqlite db,
 * flattens into the unified `jobs` shape, scrubs PII, and writes
 * committed fixture files under data.example/.
 *
 * Run: npm run import-resume-bank
 */
import Database from "better-sqlite3";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_DB = "/Users/beau/Documents/dev/Resume_bank/dashboard/data/resumebank.db";
const OUT_DIR = resolve(__dirname, "..", "data.example");

// --- PII scrubbing --------------------------------------------------------
// Replace any personal identifiers with placeholders before committing.
const PII_REPLACEMENTS: Array<[RegExp, string]> = [
  [/beauroccobruneau@gmail\.com/gi, "jane@example.com"],
  [/beau\.bruneau@[\w.]+/gi, "jane@example.com"],
  [/Beau\s+Bruneau/gi, "Jane Doe"],
  [/Bruneau,?\s*Beau/gi, "Doe, Jane"],
  [/\bBeau\b/g, "Jane"],
  [/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, "(555) 555-0100"],
];

function scrub<T>(v: T): T {
  if (v == null) return v;
  if (typeof v !== "string") return v;
  let s: string = v;
  for (const [re, rep] of PII_REPLACEMENTS) s = s.replace(re, rep);
  return s as unknown as T;
}

// --- Status mapping -------------------------------------------------------
// Posting status -> keep as-is if no application row.
// Application status -> takes precedence (unified lifecycle).
const APP_STATUSES = new Set([
  "needs_tailoring", "tailoring", "tailored", "ready_to_apply",
  "applied", "interview_invite", "declined", "on_hold",
]);
// resume_bank applications.status included 'applied' already; no remap needed.

// --- Query ---------------------------------------------------------------
type Row = {
  posting_id: number;
  company: string;
  role: string;
  location: string | null;
  salary_range: string | null;
  posting_url: string | null;
  source: string | null;
  match_score: number | null;
  match_explanation: string | null;
  posting_status: string;
  rejection_reason: string | null;
  rejection_note: string | null;
  date_found: string;
  raw_content: string | null;
  app_id: number | null;
  app_status: string | null;
  pipeline_step: string | null;
  date_tailored: string | null;
  date_submitted: string | null;
  job_posting_text: string | null;
  blueprint_text: string | null;
  resume_tex: string | null;
  review_text: string | null;
  review_verdict: string | null;
  cover_letter_text: string | null;
  application_answers_text: string | null;
  outreach_text: string | null;
  notes: string | null;
  outcome: string | null;
};

function main() {
  const db = new Database(SOURCE_DB, { readonly: true });
  const rows = db.prepare(`
    SELECT
      p.id                AS posting_id,
      p.company, p.role, p.location, p.salary_range, p.posting_url,
      p.source, p.match_score, p.match_explanation,
      p.status            AS posting_status,
      p.rejection_reason, p.rejection_note, p.date_found, p.raw_content,
      a.id                AS app_id,
      a.status            AS app_status,
      a.pipeline_step, a.date_tailored, a.date_submitted,
      a.job_posting_text, a.blueprint_text, a.resume_tex,
      a.review_text, a.review_verdict,
      a.cover_letter_text, a.application_answers_text,
      a.outreach_text, a.notes, a.outcome
    FROM postings p
    LEFT JOIN applications a ON a.posting_id = p.id
    ORDER BY p.id
  `).all() as Row[];

  const companies = new Map<string, number>();
  const companyList: { id: number; name: string }[] = [];
  const getCompanyId = (name: string) => {
    const key = name.trim().toLowerCase();
    if (companies.has(key)) return companies.get(key)!;
    const id = companyList.length + 1;
    companies.set(key, id);
    companyList.push({ id, name: name.trim() });
    return id;
  };

  // For demo, reset the 10 most recent rejected-with-no-application postings back
  // to 'new' so the Swipe page has cards to show.
  const demoNewIds = new Set(
    rows
      .filter((r) => r.app_id == null && r.posting_status === "rejected")
      .slice(-10)
      .map((r) => r.posting_id),
  );

  const jobs = rows.map((r) => {
    let status: string;
    if (demoNewIds.has(r.posting_id)) status = "new";
    else status = r.app_status && APP_STATUSES.has(r.app_status) ? r.app_status : r.posting_status;
    return {
      source: r.source ?? null,
      source_job_id: null,
      url: r.posting_url,
      title: r.role,
      company_id: getCompanyId(r.company),
      location: r.location,
      remote: null,
      salary_range: r.salary_range,
      posted_at: null,
      discovered_at: r.date_found,
      description: scrub(r.raw_content),
      score: r.match_score,
      match_explanation: r.match_explanation,
      status,
      rejection_reason: r.rejection_reason,
      rejection_note: scrub(r.rejection_note),
      pipeline_step: r.pipeline_step,
      outcome: r.outcome,
      resume_tex: scrub(r.resume_tex),
      cover_letter_md: scrub(r.cover_letter_text),
      application_answers_text: scrub(r.application_answers_text),
      outreach_text: scrub(r.outreach_text),
      review_text: scrub(r.review_text),
      review_verdict: r.review_verdict,
      submitted_at: r.date_submitted,
      notes: scrub(r.notes),
    };
  });

  mkdirSync(resolve(OUT_DIR, "base"), { recursive: true });
  writeFileSync(
    resolve(OUT_DIR, "jobs.seed.json"),
    JSON.stringify({ companies: companyList, jobs }, null, 2),
  );

  const profile = {
    full_name: "Jane Doe",
    email: "jane@example.com",
    phone: "(555) 555-0100",
    location: "New York, NY",
    links_json: { linkedin: "https://linkedin.com/in/jane-doe", github: "https://github.com/jane-doe" },
    base_resume_md: "",
    preferences_json: { remote_ok: true },
    criteria_json: {
      titles: ["Product Manager", "Senior Product Manager", "Lead Product Manager"],
      locations: ["New York, NY", "Remote"],
      keywords: ["AI", "Platform", "B2B SaaS"],
      exclusions: ["crypto", "gambling"],
      salary_min: 150000,
      remote_pref: "hybrid",
    },
  };
  writeFileSync(resolve(OUT_DIR, "profile.json"), JSON.stringify(profile, null, 2));

  writeFileSync(
    resolve(OUT_DIR, "base", "resume.md"),
    `# Jane Doe\n\njane@example.com · (555) 555-0100 · New York, NY\n\n## Summary\nProduct manager with a decade shipping B2B SaaS and AI platform products.\n\n## Experience\n(placeholder — replace with your real resume)\n`,
  );

  const byStatus = jobs.reduce<Record<string, number>>((acc, j) => {
    acc[j.status] = (acc[j.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`Imported ${jobs.length} jobs, ${companyList.length} companies`);
  console.log("Status breakdown:", byStatus);
}

main();
