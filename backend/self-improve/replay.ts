import type Database from "better-sqlite3";
import type { Criteria } from "../filters";
import { applyHardFilters } from "../filters";
import type { RawPosting } from "../sources/types";

export interface ReplayResult {
  total_candidates: number;
  would_surface: number;
  baseline_surfaced: number;
  titles: string[];
  score_distribution: Record<string, number>;
}

interface RejectedJobRow {
  id: number;
  title: string;
  location: string | null;
  remote: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_range: string | null;
  posted_at: string | null;
  description: string | null;
  source: string;
  source_job_id: string;
  url: string;
  company_name: string;
  company_domain: string | null;
  score: number | null;
  rejected_by: string | null;
  discovered_at: string;
}

function bucketScore(score: number | null): string {
  if (score === null) return "unscored";
  if (score < 20) return "<20";
  if (score < 35) return "20-34";
  if (score < 50) return "35-49";
  if (score < 65) return "50-64";
  return "65+";
}

function getRejectedJobs(db: Database.Database, lookbackDays: number): RejectedJobRow[] {
  return db
    .prepare(
      `SELECT j.id, j.title, j.location, j.remote, j.salary_min, j.salary_max,
              j.salary_range, j.posted_at, j.description, j.source, j.source_job_id,
              j.url, j.score, j.rejected_by, j.discovered_at,
              c.name AS company_name, c.domain AS company_domain
       FROM jobs j
       LEFT JOIN companies c ON c.id = j.company_id
       WHERE j.status = 'rejected'
         AND j.experiment_id IS NULL
         AND j.discovered_at >= datetime('now', ?)`,
    )
    .all(`-${lookbackDays} days`) as RejectedJobRow[];
}

function getBaselineSurfaced(db: Database.Database, lookbackDays: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM jobs
       WHERE status NOT IN ('rejected','fetched','prescored')
         AND experiment_id IS NULL
         AND discovered_at >= datetime('now', ?)`,
    )
    .get(`-${lookbackDays} days`) as { n: number };
  return row.n;
}

function toRawPosting(row: RejectedJobRow): RawPosting {
  return {
    source: row.source,
    source_job_id: row.source_job_id,
    url: row.url,
    title: row.title,
    company_name: row.company_name,
    company_domain: row.company_domain ?? undefined,
    location: row.location ?? undefined,
    remote: row.remote ?? undefined,
    salary_min: row.salary_min ?? undefined,
    salary_max: row.salary_max ?? undefined,
    salary_range: row.salary_range ?? undefined,
    posted_at: row.posted_at ?? undefined,
    description: row.description ?? undefined,
    raw: {},
  };
}

/**
 * Replay a modified Criteria against the last N days of rejected jobs.
 * Read-only — never writes to the DB.
 */
export function replayFilter(
  db: Database.Database,
  newCriteria: Criteria,
  options: { lookbackDays?: number } = {},
): ReplayResult {
  const lookbackDays = options.lookbackDays ?? 14;
  const candidates = getRejectedJobs(db, lookbackDays);
  const baseline = getBaselineSurfaced(db, lookbackDays);

  const surfaced: RejectedJobRow[] = [];
  for (const row of candidates) {
    const result = applyHardFilters(toRawPosting(row), newCriteria);
    if (result.passed) surfaced.push(row);
  }

  const scoreDistribution: Record<string, number> = {};
  for (const row of surfaced) {
    const bucket = bucketScore(row.score);
    scoreDistribution[bucket] = (scoreDistribution[bucket] ?? 0) + 1;
  }

  return {
    total_candidates: candidates.length,
    would_surface: surfaced.length,
    baseline_surfaced: baseline,
    titles: surfaced.slice(0, 30).map((r) => r.title),
    score_distribution: scoreDistribution,
  };
}

/**
 * Replay a modified score threshold against the last N days of LLM-scored rejected jobs.
 * Read-only — never writes to the DB.
 */
export function replayThreshold(
  db: Database.Database,
  newThreshold: number,
  options: { lookbackDays?: number } = {},
): ReplayResult {
  const lookbackDays = options.lookbackDays ?? 14;
  const baseline = getBaselineSurfaced(db, lookbackDays);

  // Only consider jobs rejected by the agent with a score (LLM-scored, not filter-rejected)
  const candidates = db
    .prepare(
      `SELECT j.id, j.title, j.score, j.discovered_at, c.name AS company_name
       FROM jobs j
       LEFT JOIN companies c ON c.id = j.company_id
       WHERE j.status = 'rejected'
         AND j.rejected_by = 'agent'
         AND j.score IS NOT NULL
         AND j.experiment_id IS NULL
         AND j.discovered_at >= datetime('now', ?)`,
    )
    .all(`-${lookbackDays} days`) as Array<{ id: number; title: string; score: number; company_name: string }>;

  const surfaced = candidates.filter((r) => r.score >= newThreshold);

  const scoreDistribution: Record<string, number> = {};
  for (const row of surfaced) {
    const bucket = bucketScore(row.score);
    scoreDistribution[bucket] = (scoreDistribution[bucket] ?? 0) + 1;
  }

  return {
    total_candidates: candidates.length,
    would_surface: surfaced.length,
    baseline_surfaced: baseline,
    titles: surfaced.slice(0, 30).map((r) => r.title),
    score_distribution: scoreDistribution,
  };
}
