// Company discovery orchestrator. Runs all registered FundingSource adapters
// in parallel, merges candidates, dedupes across sources and against the DB.
//
// Plugs into the orchestrator as a stage:
//   tsx scripts/orchestrate.ts --name discover [--months 3] [--rounds seed,a,b] [--sector ai]
//
// Output is a list of candidates — does NOT write to the DB. The
// add-companies skill handles enrichment + upsert.

import type Database from "better-sqlite3";
import type { FundingSource, Candidate } from "./types";
import { techcrunch } from "./techcrunch";
import { googleNews } from "./google-news";

export type { Candidate } from "./types";

export interface DiscoverOpts {
  months?: number;
  rounds?: string[];
  sectors?: string[];
}

export interface RunReport {
  candidates: Candidate[];
  already_tracked: number;
  previously_surfaced: number;
  articles_scanned: number;
  pages_fetched: number;
  sources_used: string[];
}

/** All registered funding sources. Add new ones here. */
const fundingSources: FundingSource[] = [
  techcrunch,
  googleNews,
];

export async function run(
  db: Database.Database,
  opts: DiscoverOpts = {},
): Promise<RunReport> {
  const months = opts.months ?? 3;
  const rounds = opts.rounds ?? ["seed", "a", "b"];
  const sectors = opts.sectors ?? [];

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);

  const fetchOpts = { cutoff, rounds, sectors };

  // Run all sources in parallel
  const results = await Promise.allSettled(
    fundingSources.map((s) => s.fetch(fetchOpts)),
  );

  // Merge results, noting any failures
  let articlesScanned = 0;
  let pagesFetched = 0;
  const allCandidates: Candidate[] = [];
  const sourcesUsed: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const source = fundingSources[i];
    if (result.status === "fulfilled") {
      allCandidates.push(...result.value.candidates);
      articlesScanned += result.value.articles_scanned;
      pagesFetched += result.value.pages_fetched;
      sourcesUsed.push(source.name);
    } else {
      console.error(`[discover] ${source.name} failed:`, result.reason);
    }
  }

  // Dedupe across sources — first occurrence wins (prefer earlier source in the list)
  const seen = new Set<string>();
  const deduped: Candidate[] = [];
  for (const c of allCandidates) {
    const key = c.company.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(c);
  }

  // Filter against existing companies in the DB
  const existingRows = db
    .prepare(`SELECT name FROM companies`)
    .all() as Array<{ name: string }>;
  const existing = new Set(existingRows.map((r) => r.name.toLowerCase()));

  const alreadyTracked = deduped.filter((c) =>
    existing.has(c.company.toLowerCase()),
  ).length;
  const afterCompanyFilter = deduped.filter(
    (c) => !existing.has(c.company.toLowerCase()),
  );

  // Filter against previously surfaced candidates (dismissed or already seen)
  const previousRows = db
    .prepare(`SELECT name FROM discovered_candidates`)
    .all() as Array<{ name: string }>;
  const previouslySeen = new Set(previousRows.map((r) => r.name.toLowerCase()));

  const previouslySurfaced = afterCompanyFilter.filter((c) =>
    previouslySeen.has(c.company.toLowerCase()),
  ).length;
  const newCandidates = afterCompanyFilter.filter(
    (c) => !previouslySeen.has(c.company.toLowerCase()),
  );

  // Record all new candidates so they won't resurface next run
  const upsertDiscovered = db.prepare(
    `INSERT INTO discovered_candidates (name, first_seen, last_seen)
     VALUES (?, datetime('now'), datetime('now'))
     ON CONFLICT(name) DO UPDATE SET last_seen = datetime('now')`,
  );
  for (const c of newCandidates) {
    upsertDiscovered.run(c.company);
  }

  return {
    candidates: newCandidates,
    already_tracked: alreadyTracked,
    previously_surfaced: previouslySurfaced,
    articles_scanned: articlesScanned,
    pages_fetched: pagesFetched,
    sources_used: sourcesUsed,
  };
}
