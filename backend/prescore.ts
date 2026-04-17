// Deterministic prescore pass. Reads status='fetched' rows, computes a 0-100
// signal from code-computable features, writes prescore + status='prescored'.
// No auto-reject — every row advances so the LLM sees the full picture.

import type Database from "better-sqlite3";
import type { Criteria } from "./filters";

export interface RunReport {
  prescored: number;
  skipped: number;
  errors: number;
}

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "in", "at", "to", "for", "with", "on", "by",
  "is", "be", "are", "we", "our", "you", "your", "this", "that",
]);

export function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  );
}

export function titleMatch(title: string, targetTitles: string[] | undefined): number {
  if (!targetTitles?.length) return 20;
  const titleTokens = tokenize(title);
  let best = 0;
  for (const target of targetTitles) {
    const targetTokens = tokenize(target);
    if (targetTokens.size === 0) continue;
    const overlap = [...targetTokens].filter((t) => titleTokens.has(t)).length;
    best = Math.max(best, overlap / targetTokens.size);
  }
  return Math.round(best * 40);
}

export function keywordsMatch(description: string | null | undefined, keywords: string[] | undefined): number {
  if (!keywords?.length || !description) return 0;
  const descLower = description.toLowerCase();
  const hits = keywords.filter((k) => descLower.includes(k.toLowerCase())).length;
  return Math.min(25, Math.round((hits / keywords.length) * 25));
}

const SENIOR_KEYWORDS = ["staff", "principal", "senior", "lead", "director", "vp", "head of"];
const JUNIOR_KEYWORDS = ["junior", "entry", "intern", "associate", "apprentice", "trainee"];

export function seniorityScore(title: string): number {
  const t = title.toLowerCase();
  if (JUNIOR_KEYWORDS.some((k) => t.includes(k))) return 0;
  if (SENIOR_KEYWORDS.some((k) => t.includes(k))) return 15;
  return 7;
}

export function compSignal(salaryMin: number | null | undefined, salaryRange: string | null | undefined): number {
  return salaryMin || salaryRange ? 10 : 0;
}

export function recencyScore(postedAt: string | null | undefined): number {
  if (!postedAt) return 5;
  const ageDays = (Date.now() - new Date(postedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays < 0 || isNaN(ageDays)) return 5;
  if (ageDays <= 30) return 10;
  if (ageDays <= 90) return 5;
  return 0;
}

export function computePrescore(
  row: { title: string; description: string | null; posted_at: string | null; salary_min: number | null; salary_range: string | null },
  criteria: Criteria,
): number {
  return (
    titleMatch(row.title, criteria.titles) +
    keywordsMatch(row.description, criteria.keywords) +
    seniorityScore(row.title) +
    compSignal(row.salary_min, row.salary_range) +
    recencyScore(row.posted_at)
  );
}

export async function run(db: Database.Database): Promise<RunReport> {
  const profileRow = db.prepare(`SELECT criteria_json FROM profile WHERE id = 1`).get() as
    | { criteria_json: string | null }
    | undefined;
  const criteria: Criteria = profileRow?.criteria_json ? JSON.parse(profileRow.criteria_json) : {};

  const rows = db
    .prepare(
      `SELECT id, title, description, posted_at, salary_min, salary_range FROM jobs WHERE status = 'fetched'`,
    )
    .all() as Array<{
    id: number;
    title: string;
    description: string | null;
    posted_at: string | null;
    salary_min: number | null;
    salary_range: string | null;
  }>;

  const update = db.prepare(`UPDATE jobs SET prescore = ?, status = 'prescored' WHERE id = ?`);
  let prescored = 0;
  let errors = 0;
  for (const row of rows) {
    try {
      const score = computePrescore(row, criteria);
      update.run(score, row.id);
      prescored++;
    } catch {
      errors++;
    }
  }

  return { prescored, skipped: 0, errors };
}
