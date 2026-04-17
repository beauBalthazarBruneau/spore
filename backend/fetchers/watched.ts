// Deterministic fetcher for watching=1 companies.
// No LLM — pulls from each company's ATS board, applies hard filters, writes
// survivors as status='fetched' for the score-jobs agent to pick up later.

import type Database from "better-sqlite3";
import { sources } from "../sources";
import { applyHardFilters, type Criteria } from "../filters";
import { upsertJob } from "../upsert";
import type { RawPosting } from "../sources/types";

export interface RunReport {
  fetched: number; // raw count pulled from ATS APIs
  inserted: number; // new status='fetched' rows written this run
  rejected: number; // failed hard filters
  dupes: number; // already present in the jobs table (any status)
  fetch_errors: Array<{ source: string; error: string }>;
}

export async function run(db: Database.Database): Promise<RunReport> {
  const profileRow = db.prepare(`SELECT criteria_json FROM profile WHERE id = 1`).get() as
    | { criteria_json: string | null }
    | undefined;
  const criteria: Criteria = profileRow?.criteria_json ? JSON.parse(profileRow.criteria_json) : {};

  const watched = db
    .prepare(
      `SELECT name, ats_source, ats_slug FROM companies
        WHERE watching = 1 AND ats_source IS NOT NULL AND ats_slug IS NOT NULL`,
    )
    .all() as Array<{ name: string; ats_source: string; ats_slug: string }>;

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

  // The adapters return RawPosting.company_name = ats_slug. Remap to the canonical
  // name stored on the companies row so jobs join back correctly.
  const slugToName = new Map<string, string>();
  for (const c of watched) slugToName.set(`${c.ats_source}:${c.ats_slug}`, c.name);
  for (const p of raw) {
    const canonical = slugToName.get(`${p.source}:${p.company_name}`);
    if (canonical) p.company_name = canonical;
  }

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
      upsertJob(db, p, { status: "rejected", rejection_reason: filter.reason });
      rejected++;
      continue;
    }
    upsertJob(db, p, { status: "fetched" });
    inserted++;
  }

  return { fetched: raw.length, inserted, rejected, dupes, fetch_errors };
}
