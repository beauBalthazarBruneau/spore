// Fetches from all companies where watching=1, applies hard filters + dedup,
// and emits JSON array of candidate postings for Claude to score.
//
// Usage:
//   tsx scripts/fetch-candidates.ts [--limit N] > candidates.json
//
// Side effects: postings that fail hard filters are inserted with status='rejected'
// so we don't re-score them next run. Survivors are inserted with status='fetched'
// and emitted to stdout; Claude scores them and calls upsert-scored.ts to
// promote them to 'new' (approved) or 'rejected' (below threshold).

import { getDb } from "../mcp/db";
import { sources } from "../mcp/sources";
import type { RawPosting } from "../mcp/sources/types";
import { applyHardFilters, type Criteria } from "../mcp/filters";
import { upsertJob } from "../mcp/upsert";

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) args[a.slice(2)] = argv[++i] ?? "";
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const limit = args.limit ? parseInt(args.limit, 10) : Infinity;

  const db = getDb();
  const profileRow = db.prepare(`SELECT criteria_json FROM profile WHERE id = 1`).get() as
    | { criteria_json: string | null }
    | undefined;
  const criteria: Criteria = profileRow?.criteria_json
    ? JSON.parse(profileRow.criteria_json)
    : {};

  const watched = db
    .prepare(
      `SELECT name, ats_source, ats_slug FROM companies WHERE watching = 1 AND ats_source IS NOT NULL AND ats_slug IS NOT NULL`,
    )
    .all() as Array<{ name: string; ats_source: string; ats_slug: string }>;

  const bySource = new Map<string, string[]>();
  for (const c of watched) {
    const arr = bySource.get(c.ats_source) ?? [];
    arr.push(c.ats_slug);
    bySource.set(c.ats_source, arr);
  }

  const raw: RawPosting[] = [];
  for (const [source, slugs] of bySource) {
    const adapter = sources[source];
    if (!adapter) {
      console.error(`[fetch-candidates] unknown ats_source=${source}, skipping`);
      continue;
    }
    raw.push(...(await adapter.search({ companies: slugs })));
  }

  // Remap company_name from slug back to the canonical name in the DB.
  const slugToName = new Map<string, string>();
  for (const c of watched) slugToName.set(`${c.ats_source}:${c.ats_slug}`, c.name);
  for (const p of raw) {
    const canonical = slugToName.get(`${p.source}:${p.company_name}`);
    if (canonical) p.company_name = canonical;
  }

  const candidates: RawPosting[] = [];
  let rejected = 0;
  let dupes = 0;

  for (const p of raw) {
    // dedup first — cheap. Unscored ('fetched') rows are re-emitted so Claude can score them.
    const existing = db
      .prepare(`SELECT id, status FROM jobs WHERE (source=? AND source_job_id=?) OR url=? LIMIT 1`)
      .get(p.source, p.source_job_id, p.url) as { id: number; status: string } | undefined;
    if (existing) {
      if (existing.status === "fetched") {
        candidates.push(p);
        if (candidates.length >= limit) break;
      } else {
        dupes++;
      }
      continue;
    }

    const filter = applyHardFilters(p, criteria);
    if (!filter.passed) {
      upsertJob(db, p, { status: "rejected", rejection_reason: filter.reason });
      rejected++;
      continue;
    }
    upsertJob(db, p, { status: "fetched" });
    candidates.push(p);
    if (candidates.length >= limit) break;
  }

  console.error(
    `[fetch-candidates] fetched=${raw.length} dupes=${dupes} rejected=${rejected} candidates=${candidates.length}`,
  );

  process.stdout.write(JSON.stringify(candidates, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
