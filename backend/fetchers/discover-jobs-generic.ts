// Generic (non-watched) job discovery stage. Pulls jobs from sources that
// aren't tied to a specific watched company — currently HN "Who's Hiring"
// and RemoteOK — and feeds them into the existing fetched → prescored
// pipeline.
//
// Companies auto-created here land with watching=0. Promotion to the watched
// loop happens via Swipe approval or the add-companies skill.
//
// SERP-based discovery (site:-scoped queries) is intentionally out of scope —
// WebSearch only exists inside a Claude Code session, so that lives in an
// agent (SPORE-18), not this cron-safe stage.

import type Database from "better-sqlite3";
import { applyHardFilters, type Criteria } from "../filters";
import { upsertJob } from "../upsert";
import { fetchHnHiring, type HnRunReport } from "../sources/hn";
import { fetchRemoteOk, type RemoteOkRunReport } from "../sources/remoteok";
import * as prescore from "../prescore";
import type { RawPosting } from "../sources/types";

export interface RunReport {
  hn: HnRunReport;
  remoteok: RemoteOkRunReport;
  inserted: number;
  rejected: number;
  dupes: number;
  prescore: { prescored: number; errors: number };
}

function dedupByUrlAndId(postings: RawPosting[]): RawPosting[] {
  const seen = new Set<string>();
  const out: RawPosting[] = [];
  for (const p of postings) {
    const k = `${p.source}:${p.source_job_id}|${p.url}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

export async function run(db: Database.Database): Promise<RunReport> {
  const profileRow = db.prepare(`SELECT criteria_json FROM profile WHERE id = 1`).get() as
    | { criteria_json: string | null }
    | undefined;
  const criteria: Criteria = profileRow?.criteria_json ? JSON.parse(profileRow.criteria_json) : {};

  const { postings: hnPostings, report: hnReport } = await fetchHnHiring();
  const { postings: rokPostings, report: rokReport } = await fetchRemoteOk();

  const all = dedupByUrlAndId([...hnPostings, ...rokPostings]);

  let inserted = 0;
  let rejected = 0;
  let dupes = 0;

  for (const p of all) {
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

  const prescoreReport = await prescore.run(db);

  return {
    hn: hnReport,
    remoteok: rokReport,
    inserted,
    rejected,
    dupes,
    prescore: { prescored: prescoreReport.prescored, errors: prescoreReport.errors },
  };
}
