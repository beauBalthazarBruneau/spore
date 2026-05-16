/**
 * Appends wrong-function title keywords to criteria.exclusions.title_keywords.
 * These titles were reaching the LLM scorer and being rejected immediately,
 * wasting scoring calls. Adding them to the hard filter catches them earlier.
 *
 * Run: npx tsx scripts/add-title-exclusions.ts
 */

import { getDb } from "../backend/db";

const NEW_EXCLUSIONS = [
  "software engineer",
  "account executive",
  "customer success",
  "solutions architect",
  "business development",
  "product marketing",
  "product designer",
  "machine learning engineer",
  "backend engineer",
  "data engineer",
  "recruiter",
  "solutions consultant",
  "accountant",
  // exp-003: engineering manager titles reached the LLM 12 times in 14 days, all
  // immediately rejected as wrong-function. 203 all-time EM rejections, 0 approvals.
  "engineering manager",
  // exp-004: 447 prescored jobs in the last 14 days matched these wrong-function
  // titles (driven by a 5/13 cross-company fetch deluge). Historical approval
  // rates across all-time: instructional designer 0/144, content writer 0/71,
  // ai trainer 0/108, payroll 0/86, data architect 0/16, account manager 0/240,
  // devops engineer 0/55, technical account manager 0/49. Zero false-positive
  // risk; catches the deluge at the hard filter before prescore+LLM cost.
  "instructional designer",
  "content writer",
  "ai trainer",
  "payroll",
  "data architect",
  "account manager",
  "devops engineer",
  "technical account manager",
  // exp-005: 615 'tech lead' titles fetched in the last 14 days (145 awaiting an
  // LLM scoring call, 470 already rejected). Top two non-score agent-rejection
  // reasons in the window are 'Engineering Tech Lead role, not Product Manager'
  // and 'Tech Lead engineering role, not PM'. All-time: 0/619 ever approved or
  // surfaced; every distinct 'tech lead' title is an engineering role. Substring
  // matching catches all variants (Tech Lead Manager, Frontend Tech Lead, etc.).
  "tech lead",
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
