// Tailoring output calibration report.
// For jobs that have been tailored, reports median resume and cover letter sizes
// and detects whether the user edited the output after the agent produced it.
//
// "User-edited" heuristic: if updated_at on the job row is more than 60 seconds
// after the tailoring_completed event timestamp, we count it as a user edit.
//
// Usage:
//   npx tsx backend/reports/tailor-calibration.ts

import type Database from "better-sqlite3";
import { getDb } from "../db";

const TAILORED_STATUSES = [
  "tailored",
  "ready_to_apply",
  "applied",
  "interview_invite",
  "declined",
  "on_hold",
];

interface JobRow {
  id: number;
  title: string;
  company_name: string | null;
  status: string;
  resume_md: string | null;
  cover_letter_md: string | null;
  updated_at: string;
}

interface TailoringEvent {
  job_id: number;
  completed_at: string;
}

export interface TailoredJob {
  id: number;
  title: string;
  company_name: string | null;
  status: string;
  resume_chars: number;
  cover_letter_chars: number;
  tailored_at: string | null;
  updated_at: string;
  user_edited: boolean;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function loadTailoredJobs(db: Database.Database): TailoredJob[] {
  const placeholders = TAILORED_STATUSES.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT j.id, j.title, c.name AS company_name, j.status,
              j.resume_md, j.cover_letter_md, j.updated_at
         FROM jobs j LEFT JOIN companies c ON c.id = j.company_id
        WHERE j.status IN (${placeholders})`,
    )
    .all(...TAILORED_STATUSES) as JobRow[];

  // Build a map of job_id → tailoring_completed timestamp from events
  const events = db
    .prepare(
      `SELECT entity_id AS job_id, created_at AS completed_at
         FROM events
        WHERE action = 'tailoring_completed' AND entity_type = 'job'`,
    )
    .all() as TailoringEvent[];

  const completedAt = new Map<number, string>();
  for (const e of events) {
    // Keep only the latest tailoring_completed event per job (in case of retries)
    const existing = completedAt.get(e.job_id);
    if (!existing || e.completed_at > existing) {
      completedAt.set(e.job_id, e.completed_at);
    }
  }

  return rows.map((row) => {
    const tailoredAt = completedAt.get(row.id) ?? null;
    let userEdited = false;
    if (tailoredAt && row.updated_at) {
      const diffSeconds =
        (new Date(row.updated_at).getTime() - new Date(tailoredAt).getTime()) /
        1000;
      userEdited = diffSeconds > 60;
    }
    return {
      id: row.id,
      title: row.title,
      company_name: row.company_name,
      status: row.status,
      resume_chars: row.resume_md?.length ?? 0,
      cover_letter_chars: row.cover_letter_md?.length ?? 0,
      tailored_at: tailoredAt,
      updated_at: row.updated_at,
      user_edited: userEdited,
    };
  });
}

export interface Report {
  count: number;
  median_resume_chars: number | null;
  median_cover_letter_chars: number | null;
  user_edited_count: number;
  user_edited_rate: number;
  by_status: Record<string, number>;
  jobs: TailoredJob[];
}

export function buildReport(db: Database.Database): Report {
  const jobs = loadTailoredJobs(db);
  const userEdited = jobs.filter((j) => j.user_edited).length;

  const byStatus: Record<string, number> = {};
  for (const j of jobs) {
    byStatus[j.status] = (byStatus[j.status] ?? 0) + 1;
  }

  return {
    count: jobs.length,
    median_resume_chars: median(jobs.map((j) => j.resume_chars)),
    median_cover_letter_chars: median(jobs.map((j) => j.cover_letter_chars)),
    user_edited_count: userEdited,
    user_edited_rate: jobs.length === 0 ? 0 : userEdited / jobs.length,
    by_status: byStatus,
    jobs,
  };
}

export function formatReport(r: Report): string {
  const lines: string[] = [];
  lines.push("Tailoring calibration");
  lines.push("─".repeat(60));

  if (r.count === 0) {
    lines.push("No tailored jobs found.");
    return lines.join("\n");
  }

  lines.push(`${r.count} tailored job${r.count === 1 ? "" : "s"}`);
  lines.push("");

  // Status breakdown
  lines.push("STATUS BREAKDOWN");
  for (const [status, count] of Object.entries(r.by_status).sort()) {
    lines.push(`  ${status.padEnd(20)} ${count}`);
  }
  lines.push("");

  // Size metrics
  lines.push("OUTPUT SIZE");
  lines.push(
    `  Median resume chars       ${r.median_resume_chars?.toLocaleString() ?? "—"}`,
  );
  lines.push(
    `  Median cover letter chars ${r.median_cover_letter_chars?.toLocaleString() ?? "—"}`,
  );
  lines.push("");

  // User edits
  const editPct = Math.round(r.user_edited_rate * 100);
  lines.push("USER EDITS  (updated >60s after tailoring_completed event)");
  lines.push(
    `  ${r.user_edited_count}/${r.count} jobs edited  (${editPct}%)`,
  );
  if (r.user_edited_count > 0) {
    const editedJobs = r.jobs.filter((j) => j.user_edited);
    for (const j of editedJobs) {
      lines.push(`    · [${j.id}] ${j.title} @ ${j.company_name ?? "unknown"}`);
    }
  }
  lines.push("");

  // Per-job detail
  lines.push("PER-JOB DETAIL");
  const header = "  id   resume  covltr  edited  title";
  lines.push(header);
  lines.push("  " + "─".repeat(header.length - 2));
  for (const j of r.jobs) {
    const idStr = String(j.id).padStart(4);
    const resStr = String(j.resume_chars).padStart(6);
    const covStr = String(j.cover_letter_chars).padStart(6);
    const editStr = j.user_edited ? "  yes " : "   no ";
    const label = `${j.title} @ ${j.company_name ?? "unknown"}`;
    lines.push(`  ${idStr}  ${resStr}  ${covStr}  ${editStr}  ${label}`);
  }

  return lines.join("\n");
}

function main() {
  const db = getDb();
  const report = buildReport(db);
  console.log(formatReport(report));
}

// Run when invoked directly
if (require.main === module) {
  main();
}
