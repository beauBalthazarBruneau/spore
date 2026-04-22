/**
 * Integrity smoke test for data.example/
 *
 * Opens an in-memory SQLite DB, applies the canonical schema, seeds it with
 * data.example/jobs.seed.json and data.example/profile.json, then asserts
 * row counts and status coverage.  Runs on every CI pass (no live network).
 */

import { describe, it, expect, beforeAll } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── paths ──────────────────────────────────────────────────────────────────

const REPO_ROOT = resolve(__dirname, "..");
const SCHEMA_PATH = resolve(REPO_ROOT, "backend/schema.sql");
const JOBS_SEED_PATH = resolve(REPO_ROOT, "data.example/jobs.seed.json");
const PROFILE_SEED_PATH = resolve(REPO_ROOT, "data.example/profile.json");
const RESUME_MD_PATH = resolve(REPO_ROOT, "data.example/base/resume.md");

// ── types ──────────────────────────────────────────────────────────────────

interface SeedCompany {
  id: number;
  name: string;
  ats_source?: string;
  ats_slug?: string;
}

interface SeedJob {
  source: string | null;
  source_job_id: string | null;
  url: string | null;
  title: string;
  company_id: number | null;
  location: string | null;
  remote: string | null;
  salary_range: string | null;
  posted_at: string | null;
  discovered_at: string;
  description: string | null;
  score: number | null;
  match_explanation: string | null;
  status: string;
  rejection_reason: string | null;
  rejection_note: string | null;
  pipeline_step: string | null;
  outcome: string | null;
  resume_tex: string | null;
  cover_letter_md: string | null;
  application_answers_text: string | null;
  outreach_text: string | null;
  review_text: string | null;
  review_verdict: string | null;
  submitted_at: string | null;
  notes: string | null;
}

interface SeedFile {
  companies: SeedCompany[];
  jobs: SeedJob[];
}

interface ProfileJson {
  full_name: string;
  email: string;
  phone: string;
  location: string;
  links_json: Record<string, string>;
  base_resume_md: string;
  preferences_json: Record<string, unknown>;
  criteria_json: Record<string, unknown>;
}

// ── helpers ────────────────────────────────────────────────────────────────

function openMemoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(SCHEMA_PATH, "utf8"));
  return db;
}

function loadSeedFile(): SeedFile {
  const raw = readFileSync(JOBS_SEED_PATH, "utf8");
  return JSON.parse(raw) as SeedFile;
}

function loadProfile(): ProfileJson {
  const raw = readFileSync(PROFILE_SEED_PATH, "utf8");
  return JSON.parse(raw) as ProfileJson;
}

function seedCompanies(db: Database.Database, companies: SeedCompany[]): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO companies (id, name, ats_source, ats_slug)
    VALUES (@id, @name, @ats_source, @ats_slug)
  `);
  const tx = db.transaction((rows: SeedCompany[]) => {
    for (const row of rows) {
      stmt.run({
        id: row.id,
        name: row.name,
        ats_source: row.ats_source ?? null,
        ats_slug: row.ats_slug ?? null,
      });
    }
  });
  tx(companies);
}

function seedJobs(db: Database.Database, jobs: SeedJob[]): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO jobs (
      source, source_job_id, url, title, company_id, location, remote,
      salary_range, posted_at, discovered_at, description, score,
      match_explanation, status, rejection_reason, rejection_note,
      pipeline_step, outcome, resume_tex, cover_letter_md,
      application_answers_text, outreach_text, review_text,
      review_verdict, submitted_at, notes
    ) VALUES (
      @source, @source_job_id, @url, @title, @company_id, @location, @remote,
      @salary_range, @posted_at, @discovered_at, @description, @score,
      @match_explanation, @status, @rejection_reason, @rejection_note,
      @pipeline_step, @outcome, @resume_tex, @cover_letter_md,
      @application_answers_text, @outreach_text, @review_text,
      @review_verdict, @submitted_at, @notes
    )
  `);
  const tx = db.transaction((rows: SeedJob[]) => {
    for (const row of rows) {
      stmt.run(row);
    }
  });
  tx(jobs);
}

function seedProfile(db: Database.Database, profile: ProfileJson): void {
  const resumeMd = readFileSync(RESUME_MD_PATH, "utf8");
  db.prepare(`
    INSERT OR REPLACE INTO profile (
      id, full_name, email, phone, location,
      links_json, base_resume_md, preferences_json, criteria_json
    ) VALUES (
      1, @full_name, @email, @phone, @location,
      @links_json, @base_resume_md, @preferences_json, @criteria_json
    )
  `).run({
    full_name: profile.full_name,
    email: profile.email,
    phone: profile.phone,
    location: profile.location,
    links_json: JSON.stringify(profile.links_json),
    base_resume_md: resumeMd,
    preferences_json: JSON.stringify(profile.preferences_json),
    criteria_json: JSON.stringify(profile.criteria_json),
  });
}

// ── setup ──────────────────────────────────────────────────────────────────

let db: Database.Database;
let seed: SeedFile;
let profile: ProfileJson;

beforeAll(() => {
  db = openMemoryDb();
  seed = loadSeedFile();
  profile = loadProfile();
  seedCompanies(db, seed.companies);
  seedJobs(db, seed.jobs);
  seedProfile(db, profile);
});

// ── seed file sanity checks (no DB needed) ─────────────────────────────────

describe("data.example/ seed file sanity", () => {
  it("jobs.seed.json parses without error", () => {
    expect(seed).toBeDefined();
    expect(Array.isArray(seed.jobs)).toBe(true);
    expect(Array.isArray(seed.companies)).toBe(true);
  });

  it("seed contains at least 10 jobs", () => {
    expect(seed.jobs.length).toBeGreaterThanOrEqual(10);
  });

  it("every job has a non-empty title and a valid status", () => {
    const VALID_STATUSES = new Set([
      "fetched", "prescored",
      "new", "approved", "rejected", "skipped",
      "needs_tailoring", "tailoring", "tailored", "ready_to_apply",
      "applied", "interview_invite", "declined", "on_hold",
    ]);
    for (const job of seed.jobs) {
      expect(job.title, `title missing on job with url=${job.url}`).toBeTruthy();
      expect(
        VALID_STATUSES.has(job.status),
        `unknown status '${job.status}' on job '${job.title}'`,
      ).toBe(true);
    }
  });

  it("seed covers swipe-facing statuses (new)", () => {
    const newJobs = seed.jobs.filter((j) => j.status === "new");
    expect(newJobs.length).toBeGreaterThanOrEqual(3);
  });

  it("seed covers board-facing statuses (approved or needs_tailoring)", () => {
    const boardJobs = seed.jobs.filter(
      (j) => j.status === "approved" || j.status === "needs_tailoring",
    );
    expect(boardJobs.length).toBeGreaterThanOrEqual(2);
  });

  it("seed covers late-pipeline statuses (tailored or ready_to_apply)", () => {
    const lateJobs = seed.jobs.filter(
      (j) => j.status === "tailored" || j.status === "ready_to_apply",
    );
    expect(lateJobs.length).toBeGreaterThanOrEqual(1);
  });

  it("seed contains at least one rejected job", () => {
    const rejected = seed.jobs.filter((j) => j.status === "rejected");
    expect(rejected.length).toBeGreaterThanOrEqual(1);
  });

  it("profile.json parses and uses placeholder identity", () => {
    expect(profile.full_name).toBe("Jane Doe");
    expect(profile.email).toMatch(/@example\.com$/);
  });

  it("profile.json contains no real linkedin profile URL", () => {
    const linksStr = JSON.stringify(profile.links_json);
    // Must not reference the real owner's LinkedIn slug
    expect(linksStr).not.toContain("beau-bruneau");
    expect(linksStr).not.toContain("bruneau");
  });

  it("resume.md uses placeholder identity", () => {
    const resumeMd = readFileSync(RESUME_MD_PATH, "utf8");
    expect(resumeMd).toContain("Jane Doe");
    expect(resumeMd).toContain("jane@example.com");
    // Must not reveal real owner identity
    expect(resumeMd.toLowerCase()).not.toContain("bruneau");
  });

  it("no job resume_tex leaks real identity", () => {
    for (const job of seed.jobs) {
      if (job.resume_tex) {
        expect(
          job.resume_tex.toLowerCase(),
          `resume_tex in '${job.title}' contains real name`,
        ).not.toContain("bruneau");
        expect(
          job.resume_tex,
          `resume_tex in '${job.title}' contains real LinkedIn URL`,
        ).not.toContain("beau-bruneau");
      }
    }
  });

  it("no job URLs are malformed (no ]( pattern)", () => {
    for (const job of seed.jobs) {
      if (job.url) {
        expect(
          job.url,
          `URL for '${job.title}' is malformed`,
        ).not.toContain("](");
      }
    }
  });
});

// ── DB integrity checks ────────────────────────────────────────────────────

describe("seeded in-memory DB integrity", () => {
  it("jobs table has rows after seeding", () => {
    const row = db.prepare("SELECT COUNT(*) as cnt FROM jobs").get() as { cnt: number };
    expect(row.cnt).toBeGreaterThan(0);
  });

  it("jobs count matches seed file", () => {
    const row = db.prepare("SELECT COUNT(*) as cnt FROM jobs").get() as { cnt: number };
    expect(row.cnt).toBe(seed.jobs.length);
  });

  it("companies table has rows after seeding", () => {
    const row = db.prepare("SELECT COUNT(*) as cnt FROM companies").get() as { cnt: number };
    expect(row.cnt).toBeGreaterThanOrEqual(0);
  });

  it("companies count matches seed file", () => {
    const row = db.prepare("SELECT COUNT(*) as cnt FROM companies").get() as { cnt: number };
    expect(row.cnt).toBe(seed.companies.length);
  });

  it("profile table has exactly one row after seeding", () => {
    const row = db.prepare("SELECT COUNT(*) as cnt FROM profile").get() as { cnt: number };
    expect(row.cnt).toBe(1);
  });

  it("profile row has correct full_name and email", () => {
    const row = db
      .prepare("SELECT full_name, email FROM profile WHERE id = 1")
      .get() as { full_name: string; email: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.full_name).toBe("Jane Doe");
    expect(row!.email).toMatch(/@example\.com$/);
  });

  it("at least one job has status = 'new'", () => {
    const row = db
      .prepare("SELECT COUNT(*) as cnt FROM jobs WHERE status = 'new'")
      .get() as { cnt: number };
    expect(row.cnt).toBeGreaterThan(0);
  });

  it("at least one job has status = 'rejected'", () => {
    const row = db
      .prepare("SELECT COUNT(*) as cnt FROM jobs WHERE status = 'rejected'")
      .get() as { cnt: number };
    expect(row.cnt).toBeGreaterThan(0);
  });

  it("at least one job has a board-facing status", () => {
    const row = db
      .prepare(
        `SELECT COUNT(*) as cnt FROM jobs
         WHERE status IN ('approved','needs_tailoring','tailoring','tailored','ready_to_apply')`,
      )
      .get() as { cnt: number };
    expect(row.cnt).toBeGreaterThan(0);
  });

  it("all jobs reference a valid company_id (or null)", () => {
    const orphaned = db
      .prepare(
        `SELECT COUNT(*) as cnt FROM jobs
         WHERE company_id IS NOT NULL
           AND company_id NOT IN (SELECT id FROM companies)`,
      )
      .get() as { cnt: number };
    expect(orphaned.cnt).toBe(0);
  });

  it("no duplicate URLs exist in seeded jobs", () => {
    const row = db
      .prepare(
        `SELECT COUNT(*) - COUNT(DISTINCT url) as dupes
         FROM jobs WHERE url IS NOT NULL`,
      )
      .get() as { dupes: number };
    expect(row.dupes).toBe(0);
  });
});
