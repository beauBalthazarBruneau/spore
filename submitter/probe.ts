/**
 * Application form probe — runs headless Playwright against a job's application URL,
 * detects custom questions (non-standard fields), calls Claude API to generate answers,
 * and stores everything in application_questions.
 *
 * Spawned as a background child process from the save_tailored MCP tool so it never
 * blocks the tailor response.
 *
 * Usage: npx tsx submitter/probe.ts <job_id>
 */

import { chromium } from "playwright";
import { getDb } from "../backend/db";
import { extractAshbyFields } from "./adapters/probe-ashby";

// Standard field labels/names that every ATS includes — we skip these.
const STANDARD_FIELD_PATTERNS = [
  /first.?name/i,
  /last.?name/i,
  /full.?name/i,
  /^name$/i,
  /email/i,
  /phone/i,
  /location/i,
  /city/i,
  /state/i,
  /country/i,
  /address/i,
  /linkedin/i,
  /github/i,
  /portfolio/i,
  /website/i,
  /resume/i,
  /cv/i,
  /cover.?letter/i,
  /gender/i,
  /race/i,
  /ethnicity/i,
  /veteran/i,
  /disability/i,
  /pronouns/i,
  /referral/i,
  /how.?did.?you.?hear/i,
  /salary/i,
  /compensation/i,
  /start.?date/i,
  /authorized.?to.?work/i,
  /require.?sponsorship/i,
  /willing.?to.?relocate/i,
];

function isStandardField(label: string, name: string): boolean {
  const text = `${label} ${name}`.trim();
  return STANDARD_FIELD_PATTERNS.some((re) => re.test(text));
}

function buildSelector(el: { tag: string; name: string | null; id: string | null; index: number }): string {
  if (el.name) return `[name="${el.name}"]`;
  if (el.id) return `#${el.id}`;
  return `${el.tag}:nth-of-type(${el.index + 1})`;
}


async function probe(jobId: number): Promise<void> {
  const db = getDb();

  const job = db
    .prepare(`SELECT j.id, j.url, j.title, j.description, j.source, c.name AS company FROM jobs j LEFT JOIN companies c ON c.id = j.company_id WHERE j.id = ?`)
    .get(jobId) as { id: number; url: string | null; title: string; description: string | null; source: string | null; company: string | null } | undefined;

  if (!job) {
    console.error(`[probe] job ${jobId} not found`);
    return;
  }

  if (!job.url) {
    console.log(`[probe] job ${jobId} has no URL — skipping`);
    return;
  }

  // Clear existing probe results for this job before re-probing
  db.prepare(`DELETE FROM application_questions WHERE job_id = ?`).run(jobId);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    let customFields: Array<{ label: string; fieldType: string; name: string | null; id: string | null; index: number; options?: string[] }>;

    if (job.source === "ashby") {
      console.log(`[probe] job ${jobId}: using Ashby adapter`);
      customFields = await extractAshbyFields(page, job.url);
    } else {
      // Generic fallback — navigate to the raw job URL
      const response = await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      if (!response || !response.ok()) {
        console.log(`[probe] job ${jobId}: URL returned ${response?.status()} — skipping`);
        return;
      }
      await page.waitForTimeout(2000);

      const fields = await page.evaluate(() => {
        const results: Array<{ label: string; fieldType: string; name: string | null; id: string | null; index: number; tag: string }> = [];
        const seen = new Set<string>();
        Array.from(document.querySelectorAll("input, textarea, select")).forEach((el, index) => {
          const input = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
          const inputType = (input as HTMLInputElement).type ?? "";
          if (["hidden", "submit", "button", "file", "image", "reset"].includes(inputType)) return;
          let label = "";
          const id = input.id;
          if (id) { const l = document.querySelector(`label[for="${id}"]`); if (l) label = l.textContent?.trim() ?? ""; }
          if (!label) { const c = input.closest("label"); if (c) label = c.textContent?.trim() ?? ""; }
          if (!label) { const p = input.parentElement; if (p) { const l = p.querySelector("label, legend"); if (l) label = l.textContent?.trim() ?? ""; } }
          const name = input.name || null;
          const fieldType = input.tagName.toLowerCase() === "textarea" ? "textarea" : input.tagName.toLowerCase() === "select" ? "select" : (input as HTMLInputElement).type || "text";
          const key = `${label}|${name}|${id}`;
          if (seen.has(key)) return;
          seen.add(key);
          results.push({ label, tag: input.tagName.toLowerCase(), fieldType, name, id: id || null, index });
        });
        return results;
      });
      customFields = fields.filter((f) => !isStandardField(f.label, f.name ?? ""));
    }

    if (customFields.length === 0) {
      console.log(`[probe] job ${jobId}: no custom questions found`);
      return;
    }

    console.log(`[probe] job ${jobId}: found ${customFields.length} custom question(s)`);

    const insert = db.prepare(
      `INSERT INTO application_questions (job_id, question, answer, field_type, field_selector)
       VALUES (?, ?, ?, ?, ?)`,
    );

    for (const field of customFields) {
      const question = field.label || field.name || "Unknown question";
      const selector = field.fieldType === "radio" || field.fieldType === "checkbox"
        ? `input[name="${field.name}"][type="${field.fieldType}"]`
        : buildSelector({ tag: "input", name: field.name, id: field.id, index: field.index });

      insert.run(jobId, question, null, field.fieldType, selector);
      console.log(`[probe] stored: "${question}" (${field.fieldType})`);
    }

    db.prepare(
      `INSERT INTO events (entity_type, entity_id, action, actor, payload_json) VALUES ('job', ?, 'probe_completed', 'claude', ?)`,
    ).run(jobId, JSON.stringify({ questions_found: customFields.length }));
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[probe] job ${jobId} error:`, msg);
    db.prepare(
      `INSERT INTO events (entity_type, entity_id, action, actor, payload_json) VALUES ('job', ?, 'probe_failed', 'system', ?)`,
    ).run(jobId, JSON.stringify({ error: msg }));
  } finally {
    await browser.close();
  }
}

// Entry point when run as a script
const jobId = parseInt(process.argv[2] ?? "", 10);
if (!isNaN(jobId)) {
  probe(jobId).then(() => process.exit(0)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  console.error("Usage: npx tsx submitter/probe.ts <job_id>");
  process.exit(1);
}
