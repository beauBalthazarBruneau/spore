/**
 * CLI wrapper for the replay utilities. Called by the self-improve agent to test
 * a proposed change against historical rejected jobs before committing to a PR.
 *
 * Usage:
 *   npx tsx backend/self-improve/run-replay.ts --mode threshold --threshold 30
 *   npx tsx backend/self-improve/run-replay.ts --mode filter --criteria '{"exclusions":{"title_keywords":["foo"]}}'
 *
 * The --criteria arg is merged on top of the current profile criteria, so you only
 * need to specify the fields you're changing.
 *
 * Outputs a ReplayResult JSON object to stdout.
 */

import { getDb } from "../db";
import { replayFilter, replayThreshold } from "./replay";
import type { Criteria } from "../filters";

const args = process.argv.slice(2);
const get = (flag: string) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
};

const mode = get("--mode");
if (!mode || !["filter", "threshold"].includes(mode)) {
  console.error("Usage: run-replay.ts --mode filter|threshold [--criteria JSON] [--threshold N] [--lookback-days N]");
  process.exit(1);
}

const lookbackDays = get("--lookback-days") ? parseInt(get("--lookback-days")!, 10) : 14;
const db = getDb();

if (mode === "threshold") {
  const raw = get("--threshold");
  if (!raw) { console.error("--threshold required for threshold mode"); process.exit(1); }
  const threshold = parseFloat(raw);
  const result = replayThreshold(db, threshold, { lookbackDays });
  console.log(JSON.stringify(result, null, 2));
} else {
  // filter mode: load profile criteria then merge in the proposed changes
  const profileRow = db.prepare("SELECT criteria_json FROM profile WHERE id = 1").get() as
    | { criteria_json: string | null }
    | undefined;
  const baseCriteria: Criteria = profileRow?.criteria_json
    ? JSON.parse(profileRow.criteria_json)
    : {};

  const patch: Partial<Criteria> = get("--criteria") ? JSON.parse(get("--criteria")!) : {};

  // Deep-merge exclusions so you can add individual keyword arrays without replacing all exclusions
  const merged: Criteria = {
    ...baseCriteria,
    ...patch,
    exclusions: {
      ...(baseCriteria.exclusions ?? {}),
      ...(patch.exclusions ?? {}),
      title_keywords: [
        ...(baseCriteria.exclusions?.title_keywords ?? []),
        ...(patch.exclusions?.title_keywords ?? []),
      ],
    },
  };

  const result = replayFilter(db, merged, { lookbackDays });
  console.log(JSON.stringify(result, null, 2));
}
