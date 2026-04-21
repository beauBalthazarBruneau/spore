// Deterministic fetcher for watching=1 companies.
// No LLM — pulls from each company's ATS board, applies hard filters, writes
// survivors as status='fetched' for the score-jobs agent to pick up later.
//
// Also handles:
// - Stale job cleanup: marks pre-terminal jobs no longer on the ATS board
// - Auto-archive: archives companies with N consecutive empty fetches

import type Database from "better-sqlite3";
import { sources } from "../sources";
import { applyHardFilters, type Criteria } from "../filters";
import { upsertJob } from "../upsert";
import type { RawPosting } from "../sources/types";

/** Statuses that are still "in the pipeline" and should be marked stale
 *  if the posting disappears from the ATS board. User-acted statuses
 *  (approved, needs_tailoring, etc.) are left alone. */
const STALE_ELIGIBLE = new Set(["fetched", "prescored", "new", "skipped"]);

/** Archive a company after this many consecutive runs with 0 postings. */
const EMPTY_FETCH_ARCHIVE_THRESHOLD = 5;

export interface RunReport {
  fetched: number;
  inserted: number;
  rejected: number;
  dupes: number;
  stale: number;
  archived_companies: number;
  fetch_errors: Array<{ source: string; error: string }>;
}

export async function run(db: Database.Database): Promise<RunReport> {
  const profileRow = db.prepare(`SELECT criteria_json FROM profile WHERE id = 1`).get() as
    | { criteria_json: string | null }
    | undefined;
  const criteria: Criteria = profileRow?.criteria_json ? JSON.parse(profileRow.criteria_json) : {};

  const watched = db
    .prepare(
      `SELECT id, name, ats_source, ats_slug FROM companies
        WHERE watching = 1 AND ats_source IS NOT NULL AND ats_slug IS NOT NULL AND archived = 0`,
    )
    .all() as Array<{ id: number; name: string; ats_source: string; ats_slug: string }>;

  const bySource = new Map<string, string[]>();
  for (const c of watched) {
    const arr = bySource.get(c.ats_source) ?? [];
    arr.push(c.ats_slug);
    bySource.set(c.ats_source, arr);
  }

  const raw: RawPosting[] = [];
  const fetch_errors: Array<{ source: string; error: string }> = [];
  for (const [source, slugs] of bySource) {
    const adapter = sources[source];
    if (!adapter) {
      fetch_errors.push({ source, error: "unknown ats_source" });
      continue;
    }
    try {
      raw.push(...(await adapter.search({ companies: slugs })));
    } catch (e) {
      fetch_errors.push({ source, error: (e as Error).message });
    }
  }

  // Remap ats_slug → canonical company name
  const slugToName = new Map<string, string>();
  for (const c of watched) slugToName.set(`${c.ats_source}:${c.ats_slug}`, c.name);
  for (const p of raw) {
    const canonical = slugToName.get(`${p.source}:${p.company_name}`);
    if (canonical) p.company_name = canonical;
  }

  // --- Insert / dedup / filter ---
  let inserted = 0;
  let rejected = 0;
  let dupes = 0;
  for (const p of raw) {
    const existing = db
      .prepare(`SELECT id FROM jobs WHERE (source=? AND source_job_id=?) OR url=? LIMIT 1`)
      .get(p.source, p.source_job_id, p.url) as { id: number } | undefined;
    if (existing) {
      dupes++;
      continue;
    }
    const filter = applyHardFilters(p, criteria);
    if (!filter.passed) {
      upsertJob(db, p, { status: "rejected", rejection_reason: filter.reason, rejected_by: "filter" });
      rejected++;
      continue;
    }
    upsertJob(db, p, { status: "fetched" });
    inserted++;
  }

  // --- Stale job cleanup ---
  // Build a set of currently-live source_job_ids per company
  const liveIds = new Map<string, Set<string>>();
  for (const p of raw) {
    const key = `${p.source}:${p.company_name}`;
    if (!liveIds.has(key)) liveIds.set(key, new Set());
    liveIds.get(key)!.add(p.source_job_id);
  }

  let stale = 0;
  const markStale = db.prepare(
    `UPDATE jobs SET status = 'rejected', rejection_reason = 'posting removed from ATS', rejected_by = 'filter'
     WHERE id = ? AND status IN (${[...STALE_ELIGIBLE].map(() => "?").join(",")})`,
  );
  for (const c of watched) {
    const companyKey = `${c.ats_source}:${c.name}`;
    const live = liveIds.get(companyKey) ?? new Set();
    // Find this company's pre-terminal jobs
    const existing = db
      .prepare(
        `SELECT j.id, j.source_job_id FROM jobs j
         WHERE j.company_id = ? AND j.source = ? AND j.status IN (${[...STALE_ELIGIBLE].map(() => "?").join(",")})`,
      )
      .all(c.id, c.ats_source, ...STALE_ELIGIBLE) as Array<{ id: number; source_job_id: string }>;
    for (const row of existing) {
      if (!live.has(row.source_job_id)) {
        markStale.run(row.id, ...STALE_ELIGIBLE);
        stale++;
      }
    }
  }

  // --- Auto-archive: track consecutive empty fetches ---
  let archived_companies = 0;
  const postingsPerCompany = new Map<number, number>();
  for (const c of watched) postingsPerCompany.set(c.id, 0);
  for (const p of raw) {
    const comp = watched.find((c) => c.name === p.company_name);
    if (comp) postingsPerCompany.set(comp.id, (postingsPerCompany.get(comp.id) ?? 0) + 1);
  }

  const resetCounter = db.prepare(
    `UPDATE companies SET consecutive_empty_fetches = 0 WHERE id = ?`,
  );
  const incrementCounter = db.prepare(
    `UPDATE companies SET consecutive_empty_fetches = consecutive_empty_fetches + 1 WHERE id = ?`,
  );
  const archiveCompany = db.prepare(
    `UPDATE companies SET archived = 1, watching = 0 WHERE id = ?`,
  );

  for (const c of watched) {
    const count = postingsPerCompany.get(c.id) ?? 0;
    if (count > 0) {
      resetCounter.run(c.id);
    } else {
      incrementCounter.run(c.id);
      const row = db.prepare(`SELECT consecutive_empty_fetches FROM companies WHERE id = ?`).get(c.id) as
        | { consecutive_empty_fetches: number }
        | undefined;
      if (row && row.consecutive_empty_fetches >= EMPTY_FETCH_ARCHIVE_THRESHOLD) {
        archiveCompany.run(c.id);
        archived_companies++;
      }
    }
  }

  return { fetched: raw.length, inserted, rejected, dupes, stale, archived_companies, fetch_errors };
}
