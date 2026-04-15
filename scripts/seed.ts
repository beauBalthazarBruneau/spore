/**
 * Seeds ./data/autoapply.db from ./data.example/ fixtures.
 * Idempotent: clears jobs/companies/profile before re-seeding.
 *
 * Run: npm run seed
 */
import { readFileSync, cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getDb } from "../mcp/db";

const ROOT = resolve(__dirname, "..");
const EXAMPLE = resolve(ROOT, "data.example");
const DATA = resolve(ROOT, "data");

function main() {
  // Copy base resume + profile.json into live data/ if not already there.
  if (!existsSync(resolve(DATA, "base"))) {
    cpSync(resolve(EXAMPLE, "base"), resolve(DATA, "base"), { recursive: true });
  }

  const profile = JSON.parse(readFileSync(resolve(EXAMPLE, "profile.json"), "utf8"));
  const { companies, jobs } = JSON.parse(readFileSync(resolve(EXAMPLE, "jobs.seed.json"), "utf8")) as {
    companies: { id: number; name: string }[];
    jobs: Array<Record<string, any>>;
  };

  const db = getDb();

  db.exec("DELETE FROM events; DELETE FROM jobs; DELETE FROM companies; DELETE FROM profile;");

  db.prepare(`
    INSERT INTO profile (id, full_name, email, phone, location, links_json, base_resume_path, preferences_json, criteria_json)
    VALUES (1, @full_name, @email, @phone, @location, @links_json, @base_resume_path, @preferences_json, @criteria_json)
  `).run({
    ...profile,
    links_json: JSON.stringify(profile.links_json ?? {}),
    preferences_json: JSON.stringify(profile.preferences_json ?? {}),
    criteria_json: JSON.stringify(profile.criteria_json ?? {}),
  });

  const insertCompany = db.prepare(`INSERT INTO companies (id, name) VALUES (?, ?)`);
  for (const c of companies) insertCompany.run(c.id, c.name);

  // Watchlist — companies whose ATS boards find-jobs should scan.
  const watchlistPath = resolve(EXAMPLE, "watchlist.seed.json");
  if (existsSync(watchlistPath)) {
    const watchlist = JSON.parse(readFileSync(watchlistPath, "utf8")) as Array<{
      name: string;
      ats_source: string;
      ats_slug: string;
    }>;
    const upsertWatch = db.prepare(`
      INSERT INTO companies (name, ats_source, ats_slug, watching) VALUES (?, ?, ?, 1)
      ON CONFLICT(name) DO UPDATE SET ats_source = excluded.ats_source, ats_slug = excluded.ats_slug, watching = 1
    `);
    for (const w of watchlist) upsertWatch.run(w.name, w.ats_source, w.ats_slug);
    console.log(`Watchlist: ${watchlist.length} companies marked watching=1.`);
  }

  const insertJob = db.prepare(`
    INSERT INTO jobs (
      source, url, title, company_id, location, salary_range,
      discovered_at, description, score, match_explanation,
      status, rejection_reason, rejection_note, pipeline_step, outcome,
      resume_tex, cover_letter_md, application_answers_text, outreach_text,
      review_text, review_verdict, submitted_at, notes
    ) VALUES (
      @source, @url, @title, @company_id, @location, @salary_range,
      @discovered_at, @description, @score, @match_explanation,
      @status, @rejection_reason, @rejection_note, @pipeline_step, @outcome,
      @resume_tex, @cover_letter_md, @application_answers_text, @outreach_text,
      @review_text, @review_verdict, @submitted_at, @notes
    )
  `);

  const insertMany = db.transaction((rows: any[]) => {
    for (const j of rows) {
      // Dedupe URL — resume_bank had a malformed url pattern for one company.
      try {
        insertJob.run(j);
      } catch (e: any) {
        if (!/UNIQUE/.test(e.message)) throw e;
      }
    }
  });
  insertMany(jobs);

  const count = (db.prepare(`SELECT COUNT(*) AS n FROM jobs`).get() as { n: number }).n;
  console.log(`Seeded: ${companies.length} companies, ${count} jobs.`);
}

main();
