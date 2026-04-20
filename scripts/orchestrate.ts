// Orchestrator for deterministic fetchers. Cron (set up later) invokes this
// with --name <fetcher>; it dispatches to the matching module in
// backend/fetchers/, logs a <name>_fetch_run event with counts + duration,
// and exits non-zero on failure so cron can mail you.
//
// Usage:
//   tsx scripts/orchestrate.ts --name watched
//   tsx scripts/orchestrate.ts --name discover [--months 3] [--rounds seed,a,b] [--sector ai,devtools]

import { getDb } from "../backend/db";
import * as watched from "../backend/fetchers/watched";
import * as prescore from "../backend/prescore";
import * as discover from "../backend/fetchers/discover";

interface Stage {
  run: (db: import("better-sqlite3").Database, extra?: Record<string, string>) => Promise<object>;
}

// Wrap discover.run to accept the generic Stage signature and forward CLI args
const discoverStage: Stage = {
  async run(db, extra = {}) {
    const opts: discover.DiscoverOpts = {};
    if (extra.months) opts.months = parseInt(extra.months, 10);
    if (extra.rounds) opts.rounds = extra.rounds.split(",");
    if (extra.sector) opts.sectors = extra.sector.split(",");
    return discover.run(db, opts);
  },
};

const fetchers: Record<string, Stage> = {
  watched,
  prescore,
  discover: discoverStage,
};

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) args[a.slice(2)] = argv[++i] ?? "";
  }
  return args;
}

function available(): string {
  return Object.keys(fetchers).join(", ");
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.name) {
    console.error("usage: tsx scripts/orchestrate.ts --name <fetcher>");
    console.error(`available: ${available()}`);
    process.exit(1);
  }
  const f = fetchers[args.name];
  if (!f) {
    console.error(`unknown fetcher: ${args.name}`);
    console.error(`available: ${available()}`);
    process.exit(1);
  }

  const db = getDb();
  const logEvent = db.prepare(
    `INSERT INTO events (entity_type, entity_id, action, actor, payload_json) VALUES (?,?,?,?,?)`,
  );
  const start = Date.now();
  try {
    const { name: _, ...extra } = args;
    const report = await f.run(db, extra);
    const duration_ms = Date.now() - start;
    const payload = { ...report, duration_ms };
    logEvent.run("system", 0, `${args.name}_fetch_run`, "system", JSON.stringify(payload));
    console.log(`[${args.name}] ${JSON.stringify(payload)}`);
  } catch (err) {
    const duration_ms = Date.now() - start;
    const payload = { error: (err as Error).message, duration_ms };
    logEvent.run("system", 0, `${args.name}_fetch_run`, "system", JSON.stringify(payload));
    console.error(`[${args.name}] failed:`, err);
    process.exit(1);
  }
}

main();
