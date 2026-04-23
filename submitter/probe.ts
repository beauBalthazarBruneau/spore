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
import Anthropic from "@anthropic-ai/sdk";
import { getDb } from "../backend/db";

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

async function generateAnswer(
  client: Anthropic,
  question: string,
  jobContext: { title: string; company: string; description: string | null },
  profile: { full_name: string | null; preferences_json: string | null },
): Promise<string> {
  const preferences = profile.preferences_json ? JSON.parse(profile.preferences_json) : {};
  const prompt = `You are filling out a job application on behalf of ${profile.full_name ?? "the applicant"}.

Job: ${jobContext.title} at ${jobContext.company}
Job description excerpt: ${(jobContext.description ?? "").slice(0, 1500)}

Applicant preferences/notes: ${JSON.stringify(preferences)}

Application question: "${question}"

Write a concise, honest, professional answer to this question. 2–4 sentences max unless the question requires more detail. Do not fabricate credentials or experiences. If you lack enough context to answer confidently, write a placeholder like "[Answer needed]".`;

  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  });

  return (msg.content[0] as { type: "text"; text: string }).text.trim();
}

async function probe(jobId: number): Promise<void> {
  const db = getDb();

  const job = db
    .prepare(`SELECT j.id, j.url, j.title, j.description, c.name AS company FROM jobs j LEFT JOIN companies c ON c.id = j.company_id WHERE j.id = ?`)
    .get(jobId) as { id: number; url: string | null; title: string; description: string | null; company: string | null } | undefined;

  if (!job) {
    console.error(`[probe] job ${jobId} not found`);
    return;
  }

  if (!job.url) {
    console.log(`[probe] job ${jobId} has no URL — skipping`);
    return;
  }

  const profile = db
    .prepare(`SELECT full_name, preferences_json FROM profile WHERE id = 1`)
    .get() as { full_name: string | null; preferences_json: string | null } | undefined;

  // Clear existing probe results for this job before re-probing
  db.prepare(`DELETE FROM application_questions WHERE job_id = ?`).run(jobId);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    const response = await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 30_000 });

    if (!response || !response.ok()) {
      console.log(`[probe] job ${jobId}: URL returned ${response?.status()} — skipping`);
      return;
    }

    // Wait briefly for JS-rendered content
    await page.waitForTimeout(2000);

    type FieldInfo = {
      label: string;
      tag: string;
      fieldType: string;
      name: string | null;
      id: string | null;
      index: number;
    };

    // Extract all interactive form fields with their labels
    const fields: FieldInfo[] = await page.evaluate(() => {
      const results: FieldInfo[] = [];
      const seen = new Set<string>();

      const inputs = Array.from(document.querySelectorAll("input, textarea, select"));
      inputs.forEach((el, index) => {
        const input = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        const inputType = (input as HTMLInputElement).type ?? "";

        // Skip hidden, submit, button, file inputs
        if (["hidden", "submit", "button", "file", "image", "reset"].includes(inputType)) return;

        // Find associated label
        let label = "";
        const id = input.id;
        if (id) {
          const labelEl = document.querySelector(`label[for="${id}"]`);
          if (labelEl) label = labelEl.textContent?.trim() ?? "";
        }
        if (!label) {
          const closest = input.closest("label");
          if (closest) label = closest.textContent?.trim() ?? "";
        }
        if (!label) {
          // Walk up to find nearby label/legend/div text
          const parent = input.parentElement;
          if (parent) {
            const labelEl = parent.querySelector("label, legend");
            if (labelEl) label = labelEl.textContent?.trim() ?? "";
          }
        }

        const name = input.name || null;
        const fieldType = input.tagName.toLowerCase() === "textarea"
          ? "textarea"
          : input.tagName.toLowerCase() === "select"
          ? "select"
          : (input as HTMLInputElement).type || "text";

        const dedupeKey = `${label}|${name}|${id}`;
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);

        results.push({ label, tag: input.tagName.toLowerCase(), fieldType, name, id: id || null, index });
      });

      return results;
    });

    const customFields = fields.filter((f) => !isStandardField(f.label, f.name ?? ""));

    if (customFields.length === 0) {
      console.log(`[probe] job ${jobId}: no custom questions found`);
      return;
    }

    console.log(`[probe] job ${jobId}: found ${customFields.length} custom question(s)`);

    const client = new Anthropic();

    const insert = db.prepare(
      `INSERT INTO application_questions (job_id, question, answer, field_type, field_selector)
       VALUES (?, ?, ?, ?, ?)`,
    );

    for (const field of customFields) {
      const question = field.label || field.name || "Unknown question";
      const selector = buildSelector(field);
      let answer: string | null = null;

      try {
        answer = await generateAnswer(
          client,
          question,
          { title: job.title, company: job.company ?? "", description: job.description },
          profile ?? { full_name: null, preferences_json: null },
        );
      } catch (e) {
        console.error(`[probe] failed to generate answer for "${question}":`, (e as Error).message);
      }

      insert.run(jobId, question, answer, field.fieldType, selector);
      console.log(`[probe] stored: "${question}" (${field.fieldType}) → ${answer ? answer.slice(0, 60) + "..." : "null"}`);
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
