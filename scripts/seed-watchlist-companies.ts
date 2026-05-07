/**
 * Seeds VC-backed hiring companies into the watchlist.
 * Each company is upserted by name -- existing rows are updated, not duplicated.
 * Companies whose ATS is unsupported (Workday, Comeet, etc.) are listed at the bottom
 * as skipped so Beau can decide how to handle them.
 *
 * Run: npx tsx scripts/seed-watchlist-companies.ts
 */

import { getDb } from "../backend/db";

const COMPANIES: Array<{
  name: string;
  ats_source: "greenhouse" | "lever" | "ashby" | "rippling";
  ats_slug: string;
}> = [
  // Ashby
  { name: "Hadrian", ats_source: "ashby", ats_slug: "hadrian-automation" },
  { name: "Cursor", ats_source: "ashby", ats_slug: "cursor" },
  { name: "Legora", ats_source: "ashby", ats_slug: "legora" },
  { name: "Harvey", ats_source: "ashby", ats_slug: "harvey" },
  { name: "Fluidstack", ats_source: "ashby", ats_slug: "fluidstack" },
  { name: "Etched", ats_source: "ashby", ats_slug: "Etched" },
  { name: "Replit", ats_source: "ashby", ats_slug: "replit" },
  { name: "Whatnot", ats_source: "ashby", ats_slug: "whatnot" },
  { name: "Sierra", ats_source: "ashby", ats_slug: "Sierra" },
  { name: "ElevenLabs", ats_source: "ashby", ats_slug: "elevenlabs" },
  { name: "Dandy", ats_source: "ashby", ats_slug: "dandy" },
  // Greenhouse
  { name: "Archer", ats_source: "greenhouse", ats_slug: "archer56" },
  { name: "Figure", ats_source: "greenhouse", ats_slug: "figureai" },
  { name: "Applied Intuition", ats_source: "greenhouse", ats_slug: "appliedintuition" },
  { name: "Glean", ats_source: "greenhouse", ats_slug: "gleanwork" },
  { name: "Zipline", ats_source: "greenhouse", ats_slug: "flyzipline" },
  { name: "Aura", ats_source: "greenhouse", ats_slug: "aura798" },
  { name: "Oura", ats_source: "greenhouse", ats_slug: "oura" },
  { name: "Nuro", ats_source: "greenhouse", ats_slug: "nuro" },
  { name: "Transcarent", ats_source: "greenhouse", ats_slug: "transcarent" },
  { name: "Helsing", ats_source: "greenhouse", ats_slug: "helsing" },
  { name: "ClickHouse", ats_source: "greenhouse", ats_slug: "clickhouse" },
  { name: "Abnormal Security", ats_source: "greenhouse", ats_slug: "abnormalsecurity" },
  { name: "Checkr", ats_source: "greenhouse", ats_slug: "checkr" },
  // Lever
  { name: "WHOOP", ats_source: "lever", ats_slug: "whoop" },
  { name: "Outreach", ats_source: "lever", ats_slug: "outreach" },
  { name: "Pennylane", ats_source: "lever", ats_slug: "pennylane" },
  { name: "Saronic Technologies", ats_source: "lever", ats_slug: "saronic" },
  { name: "Wealthsimple", ats_source: "lever", ats_slug: "wealthsimple" },
];

// Companies skipped due to unsupported ATS
const SKIPPED = [
  { name: "Cyera", reason: "Uses Comeet (unsupported)" },
  { name: "X-energy", reason: "Uses Workday (unsupported)" },
  { name: "Teva", reason: "Could not identify a small-biz payments startup called Teva -- likely misidentified in source; Teva Pharmaceuticals uses a custom careers site" },
];

const db = getDb();

let added = 0;
let updated = 0;

for (const company of COMPANIES) {
  const existing = db
    .prepare(`SELECT id, watching FROM companies WHERE name = ? COLLATE NOCASE`)
    .get(company.name) as { id: number; watching: number } | undefined;

  db.prepare(
    `INSERT INTO companies (name, ats_source, ats_slug, watching)
     VALUES (@name, @ats_source, @ats_slug, 1)
     ON CONFLICT(name) DO UPDATE SET
       ats_source = excluded.ats_source,
       ats_slug   = excluded.ats_slug,
       watching   = 1,
       archived   = 0`,
  ).run(company);

  if (existing) {
    updated++;
    console.log(`  updated: ${company.name} (${company.ats_source}/${company.ats_slug})`);
  } else {
    added++;
    console.log(`  added:   ${company.name} (${company.ats_source}/${company.ats_slug})`);
  }
}

console.log(`\nDone. ${added} added, ${updated} updated.`);

if (SKIPPED.length > 0) {
  console.log("\nSkipped (unsupported ATS):");
  for (const s of SKIPPED) {
    console.log(`  - ${s.name}: ${s.reason}`);
  }
}
