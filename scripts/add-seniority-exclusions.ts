/**
 * Appends over-senior and wrong-function title keywords to criteria.exclusions.title_keywords.
 * These were reaching the LLM scorer (and sometimes the swipe queue) and being rejected
 * as seniority mismatches, wasting scoring calls.
 *
 * Run: npx tsx scripts/add-seniority-exclusions.ts
 */

import { getDb } from "../backend/db";

const NEW_EXCLUSIONS = [
  "staff product manager",
  "vp of product",
  "vice president of product",
  "vice president, product",
];

const db = getDb();

const row = db.prepare("SELECT criteria_json FROM profile WHERE id = 1").get() as
  | { criteria_json: string | null }
  | undefined;

if (!row) {
  console.error("No profile row found.");
  process.exit(1);
}

const criteria = row.criteria_json ? JSON.parse(row.criteria_json) : {};
const existing: string[] = criteria.exclusions?.title_keywords ?? [];

const toAdd = NEW_EXCLUSIONS.filter((kw) => !existing.includes(kw));
if (toAdd.length === 0) {
  console.log("All keywords already present — nothing to do.");
  process.exit(0);
}

const updated = {
  ...criteria,
  exclusions: {
    ...(criteria.exclusions ?? {}),
    title_keywords: [...existing, ...toAdd],
  },
};

db.prepare("UPDATE profile SET criteria_json = ? WHERE id = 1").run(JSON.stringify(updated));

console.log(`Added ${toAdd.length} title exclusion keywords: ${toAdd.join(", ")}`);
