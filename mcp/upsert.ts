import type Database from "better-sqlite3";
import type { RawPosting } from "./sources/types";

export function upsertCompany(db: Database.Database, name: string, domain?: string): number {
  const existing = db.prepare(`SELECT id FROM companies WHERE name = ? COLLATE NOCASE`).get(name) as
    | { id: number }
    | undefined;
  if (existing) return existing.id;
  const info = db
    .prepare(`INSERT INTO companies (name, domain) VALUES (?, ?)`)
    .run(name, domain ?? null);
  return Number(info.lastInsertRowid);
}

export interface UpsertOpts {
  status?: string;
  score?: number;
  match_explanation?: string;
  rejection_reason?: string;
  decline_reason?: string;
}

// Returns { id, inserted } — inserted=false if the job already existed (dedup by source+source_job_id or url).
export function upsertJob(
  db: Database.Database,
  p: RawPosting,
  opts: UpsertOpts = {},
): { id: number; inserted: boolean } {
  const dedup = db
    .prepare(
      `SELECT id FROM jobs WHERE (source = ? AND source_job_id = ?) OR url = ? LIMIT 1`,
    )
    .get(p.source, p.source_job_id, p.url) as { id: number } | undefined;
  if (dedup) return { id: dedup.id, inserted: false };

  const companyId = upsertCompany(db, p.company_name, p.company_domain);
  const info = db
    .prepare(
      `INSERT INTO jobs (
        source, source_job_id, url, title, company_id, location, remote,
        salary_min, salary_max, salary_range, posted_at, description, raw_json,
        score, match_explanation, status, rejection_reason
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      p.source,
      p.source_job_id,
      p.url,
      p.title,
      companyId,
      p.location ?? null,
      p.remote ?? null,
      p.salary_min ?? null,
      p.salary_max ?? null,
      p.salary_range ?? null,
      p.posted_at ?? null,
      p.description ?? null,
      JSON.stringify(p.raw),
      opts.score ?? null,
      opts.match_explanation ?? null,
      opts.status ?? "new",
      opts.rejection_reason ?? opts.decline_reason ?? null,
    );
  return { id: Number(info.lastInsertRowid), inserted: true };
}

// Upsert a scored posting: updates an existing row (e.g. status='fetched') in place,
// or inserts a fresh row if none exists. Returns whether a row was inserted.
export function upsertScoredJob(
  db: Database.Database,
  p: RawPosting,
  opts: UpsertOpts & { status: string; score: number },
): { id: number; inserted: boolean } {
  const existing = db
    .prepare(
      `SELECT id FROM jobs WHERE (source = ? AND source_job_id = ?) OR url = ? LIMIT 1`,
    )
    .get(p.source, p.source_job_id, p.url) as { id: number } | undefined;
  if (existing) {
    db.prepare(
      `UPDATE jobs SET status = ?, score = ?, match_explanation = ?, rejection_reason = ? WHERE id = ?`,
    ).run(
      opts.status,
      opts.score,
      opts.match_explanation ?? null,
      opts.rejection_reason ?? opts.decline_reason ?? null,
      existing.id,
    );
    return { id: existing.id, inserted: false };
  }
  return upsertJob(db, p, opts);
}
