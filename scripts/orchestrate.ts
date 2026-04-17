// Orchestrator for deterministic fetchers. Cron (set up later) invokes this
// with --name <fetcher>; it dispatches to the matching module in
// backend/fetchers/, logs a <name>_fetch_run event with counts + duration,
// and exits non-zero on failure so cron can mail you.
//
// Usage:
//   tsx scripts/orchestrate.ts --name watched

import { getDb } from "../backend/db";
import * as watched from "../backend/fetchers/watched";
import * as prescore from "../backend/prescore";

interface Stage {
  run: (db: import("better-sqlite3").Database) => Promise<object>;
}

const fetchers: Record<string, Stage> = {
  watched,
  prescore,
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
    const report = await f.run(db);
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
