// Reads scored candidates from stdin (JSON array) and inserts them.
// Shape: RawPosting & { score: number, match_explanation?: string, decline_reason?: string }
//
// Usage:
//   cat scored.json | tsx scripts/upsert-scored.ts [--threshold 60]

import { getDb } from "../mcp/db";
import { upsertScoredJob } from "../mcp/upsert";
import type { RawPosting } from "../mcp/sources/types";

interface Scored extends RawPosting {
  score: number;
  match_explanation?: string;
  decline_reason?: string;
}

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) args[a.slice(2)] = argv[++i] ?? "";
  }
  return args;
}

async function readStdin(): Promise<string> {
  return new Promise((res) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (buf += c));
    process.stdin.on("end", () => res(buf));
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const threshold = args.threshold ? parseInt(args.threshold, 10) : 60;
  const db = getDb();

  const input = await readStdin();
  const scored: Scored[] = JSON.parse(input);

  let promoted = 0;
  let declined = 0;
  for (const s of scored) {
    const status = s.score >= threshold ? "new" : "rejected";
    upsertScoredJob(db, s, {
      status,
      score: s.score,
      match_explanation: s.match_explanation,
      rejection_reason: status === "rejected" ? s.decline_reason ?? `score ${s.score} < ${threshold}` : undefined,
    });
    if (status === "new") promoted++;
    else declined++;
  }
  const inserted = promoted;
  const skipped = declined;

  db.prepare(
    `INSERT INTO events (entity_type, entity_id, action, actor, payload_json) VALUES (?,?,?,?,?)`,
  ).run(
    "system",
    0,
    "find_jobs_run",
    "claude",
    JSON.stringify({ total: scored.length, inserted, skipped, threshold }),
  );

  console.log(JSON.stringify({ total: scored.length, inserted, skipped, threshold }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
