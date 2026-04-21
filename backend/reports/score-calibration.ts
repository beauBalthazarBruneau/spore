// Score-vs-outcome correlation report.
// For each score bucket, shows what fraction of user-decided jobs were approved.
// Helps answer: "are prescore and LLM score actually predictive?"
//
// Usage:
//   npx tsx backend/reports/score-calibration.ts

import type Database from "better-sqlite3";
import { getDb } from "../db";

// Any post-approval status counts as "user approved this job"
const APPROVED_STATUSES = [
  "approved",
  "needs_tailoring", "tailoring", "tailored",
  "ready_to_apply", "applied",
  "interview_invite", "declined", "on_hold",
];

interface Row {
  prescore: number | null;
  score: number | null;
  status: string;
  rejected_by: string | null;
}

interface Label {
  prescore: number | null;
  score: number | null;
  approved: boolean;
}

/** Pull jobs the user decided on (approved or user-rejected). Excludes skipped,
 *  filter/agent-only rejections, and still-queued jobs. */
export function loadUserDecidedJobs(db: Database.Database): Label[] {
  const approvedPlaceholders = APPROVED_STATUSES.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT prescore, score, status, rejected_by FROM jobs
       WHERE (status IN (${approvedPlaceholders}))
          OR (status = 'rejected' AND rejected_by = 'user')`,
    )
    .all(...APPROVED_STATUSES) as Row[];

  return rows.map((r) => ({
    prescore: r.prescore,
    score: r.score,
    approved: r.status !== "rejected",
  }));
}

export interface Bucket {
  label: string; // "60-70"
  low: number;
  high: number;
  approved: number;
  rejected: number;
  rate: number; // approved / total
}

/** Bin labels by score in 10-wide buckets. Drops null scores. */
export function bucketize(
  labels: Label[],
  scoreField: "prescore" | "score",
): Bucket[] {
  const buckets: Bucket[] = [];
  for (let low = 0; low < 100; low += 10) {
    const high = low + 10;
    buckets.push({
      label: `${low}-${high}`,
      low, high,
      approved: 0,
      rejected: 0,
      rate: 0,
    });
  }

  for (const l of labels) {
    const s = l[scoreField];
    if (s === null || s === undefined) continue;
    const idx = Math.min(Math.floor(s / 10), 9);
    const b = buckets[idx];
    if (l.approved) b.approved++;
    else b.rejected++;
  }

  for (const b of buckets) {
    const total = b.approved + b.rejected;
    b.rate = total === 0 ? 0 : b.approved / total;
  }
  return buckets;
}

/** Pearson correlation between score and the binary approved label.
 *  Drops rows where the score is null. Returns 0 if fewer than 2 samples. */
export function pearson(labels: Label[], scoreField: "prescore" | "score"): number {
  const pts = labels
    .filter((l) => l[scoreField] !== null && l[scoreField] !== undefined)
    .map((l) => ({ x: l[scoreField]!, y: l.approved ? 1 : 0 }));
  if (pts.length < 2) return 0;

  const n = pts.length;
  const sumX = pts.reduce((a, p) => a + p.x, 0);
  const sumY = pts.reduce((a, p) => a + p.y, 0);
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0, denomX = 0, denomY = 0;
  for (const p of pts) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    num += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  const denom = Math.sqrt(denomX * denomY);
  return denom === 0 ? 0 : num / denom;
}

function formatBuckets(buckets: Bucket[]): string {
  const lines: string[] = [];
  // Find widest "n/m" column for alignment
  const maxPair = Math.max(
    ...buckets.map((b) => `${b.approved}/${b.approved + b.rejected}`.length),
  );
  for (const b of buckets) {
    const total = b.approved + b.rejected;
    if (total === 0) continue;
    const pair = `${b.approved}/${total}`.padStart(maxPair);
    const rate = `${Math.round(b.rate * 100).toString().padStart(3)}%`;
    const bar = "▇".repeat(Math.round(b.rate * 20));
    lines.push(`  ${b.label.padStart(6)}  ${pair} approved  ${rate}  ${bar}`);
  }
  return lines.join("\n");
}

function interpret(r: number): string {
  const abs = Math.abs(r);
  if (abs < 0.1) return "essentially no signal";
  if (abs < 0.3) return "weak but non-zero";
  if (abs < 0.5) return "moderate";
  if (abs < 0.7) return "strong";
  return "very strong";
}

export interface Report {
  total_user_decisions: number;
  approved: number;
  user_rejected: number;
  prescore_buckets: Bucket[];
  llm_score_buckets: Bucket[];
  prescore_correlation: number;
  llm_score_correlation: number;
  prescore_samples: number;
  llm_score_samples: number;
}

export function buildReport(db: Database.Database): Report {
  const labels = loadUserDecidedJobs(db);
  const approved = labels.filter((l) => l.approved).length;
  const prescoreSamples = labels.filter((l) => l.prescore !== null).length;
  const llmSamples = labels.filter((l) => l.score !== null).length;
  return {
    total_user_decisions: labels.length,
    approved,
    user_rejected: labels.length - approved,
    prescore_buckets: bucketize(labels, "prescore"),
    llm_score_buckets: bucketize(labels, "score"),
    prescore_correlation: pearson(labels, "prescore"),
    llm_score_correlation: pearson(labels, "score"),
    prescore_samples: prescoreSamples,
    llm_score_samples: llmSamples,
  };
}

export function formatReport(r: Report): string {
  const lines: string[] = [];
  lines.push("Score-vs-outcome calibration");
  lines.push("─".repeat(60));
  lines.push(
    `${r.total_user_decisions} user-decided jobs  ·  ${r.approved} approved  ·  ${r.user_rejected} rejected`,
  );
  lines.push("");

  lines.push(`PRESCORE  (${r.prescore_samples} samples)`);
  if (r.prescore_samples === 0) lines.push("  (no data)");
  else {
    lines.push(formatBuckets(r.prescore_buckets));
    lines.push("");
    lines.push(
      `  correlation with approval: ${r.prescore_correlation.toFixed(3)}  (${interpret(r.prescore_correlation)})`,
    );
  }
  lines.push("");

  lines.push(`LLM SCORE  (${r.llm_score_samples} samples)`);
  if (r.llm_score_samples === 0) lines.push("  (no data)");
  else {
    lines.push(formatBuckets(r.llm_score_buckets));
    lines.push("");
    lines.push(
      `  correlation with approval: ${r.llm_score_correlation.toFixed(3)}  (${interpret(r.llm_score_correlation)})`,
    );
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
