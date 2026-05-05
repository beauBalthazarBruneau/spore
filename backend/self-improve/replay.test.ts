import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { replayFilter, replayThreshold } from "./replay";
import type { Criteria } from "../filters";

function setupDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(__dirname, "../schema.sql"), "utf8"));
  // Apply experiment_id migration
  db.exec(`ALTER TABLE jobs ADD COLUMN experiment_id TEXT`);
  return db;
}

function insertCompany(db: Database.Database, name: string): number {
  return Number(
    db.prepare(`INSERT INTO companies (name) VALUES (?)`).run(name).lastInsertRowid,
  );
}

function insertJob(
  db: Database.Database,
  opts: {
    title: string;
    company_id: number;
    status: string;
    location?: string;
    remote?: string;
    score?: number;
    rejected_by?: string;
    experiment_id?: string;
    discovered_at?: string;
  },
) {
  db.prepare(
    `INSERT INTO jobs (title, company_id, status, location, remote, score, rejected_by, experiment_id, discovered_at, source, source_job_id, url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'test', ?, ?)`,
  ).run(
    opts.title,
    opts.company_id,
    opts.status,
    opts.location ?? null,
    opts.remote ?? null,
    opts.score ?? null,
    opts.rejected_by ?? null,
    opts.experiment_id ?? null,
    opts.discovered_at ?? new Date().toISOString(),
    String(Math.random()),
    `https://example.com/${Math.random()}`,
  );
}

describe("replayFilter", () => {
  let db: Database.Database;
  let companyId: number;

  beforeEach(() => {
    db = setupDb();
    companyId = insertCompany(db, "Acme");
  });

  it("returns zeros for empty window", () => {
    const result = replayFilter(db, {}, { lookbackDays: 14 });
    expect(result.total_candidates).toBe(0);
    expect(result.would_surface).toBe(0);
    expect(result.baseline_surfaced).toBe(0);
    expect(result.titles).toEqual([]);
  });

  it("counts rejected jobs that pass the new criteria", () => {
    insertJob(db, { title: "Product Manager", company_id: companyId, status: "rejected", location: "New York, NY" });
    insertJob(db, { title: "Software Engineer", company_id: companyId, status: "rejected", location: "New York, NY" });
    insertJob(db, { title: "Product Manager", company_id: companyId, status: "rejected", location: "London, UK" });

    const criteria: Criteria = {
      locations: ["New York, NY", "Remote"],
      remote_pref: "hybrid",
    };
    const result = replayFilter(db, criteria, { lookbackDays: 14 });

    expect(result.total_candidates).toBe(3);
    expect(result.would_surface).toBe(2); // both NY jobs pass (both titles pass — no exclusions set)
    expect(result.titles).toContain("Product Manager");
  });

  it("excludes jobs that belong to an existing experiment", () => {
    insertJob(db, { title: "Product Manager", company_id: companyId, status: "rejected", location: "New York, NY" });
    insertJob(db, { title: "Product Manager", company_id: companyId, status: "rejected", location: "New York, NY", experiment_id: "exp-001" });

    const result = replayFilter(db, {}, { lookbackDays: 14 });
    expect(result.total_candidates).toBe(1); // experiment-tagged job excluded
  });

  it("excludes jobs outside the lookback window", () => {
    const old = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    insertJob(db, { title: "Product Manager", company_id: companyId, status: "rejected", discovered_at: old });

    const result = replayFilter(db, {}, { lookbackDays: 14 });
    expect(result.total_candidates).toBe(0);
  });

  it("includes non-rejected jobs in baseline_surfaced count", () => {
    insertJob(db, { title: "Product Manager", company_id: companyId, status: "needs_tailoring" });
    insertJob(db, { title: "Senior PM", company_id: companyId, status: "new" });

    const result = replayFilter(db, {}, { lookbackDays: 14 });
    expect(result.baseline_surfaced).toBe(2);
  });

  it("populates score_distribution for surfaced jobs", () => {
    insertJob(db, { title: "PM", company_id: companyId, status: "rejected", score: 40 });
    insertJob(db, { title: "Senior PM", company_id: companyId, status: "rejected", score: 55 });

    const result = replayFilter(db, {}, { lookbackDays: 14 });
    expect(result.score_distribution["35-49"]).toBe(1);
    expect(result.score_distribution["50-64"]).toBe(1);
  });
});

describe("replayThreshold", () => {
  let db: Database.Database;
  let companyId: number;

  beforeEach(() => {
    db = setupDb();
    companyId = insertCompany(db, "Acme");
  });

  it("returns zeros for empty window", () => {
    const result = replayThreshold(db, 35, { lookbackDays: 14 });
    expect(result.total_candidates).toBe(0);
    expect(result.would_surface).toBe(0);
  });

  it("surfaces agent-rejected jobs above the new threshold", () => {
    insertJob(db, { title: "PM", company_id: companyId, status: "rejected", rejected_by: "agent", score: 40 });
    insertJob(db, { title: "Senior PM", company_id: companyId, status: "rejected", rejected_by: "agent", score: 55 });
    insertJob(db, { title: "Junior PM", company_id: companyId, status: "rejected", rejected_by: "agent", score: 20 });
    // filter rejection — should not count
    insertJob(db, { title: "Engineer", company_id: companyId, status: "rejected", rejected_by: "filter", score: 50 });

    const result = replayThreshold(db, 35, { lookbackDays: 14 });
    expect(result.total_candidates).toBe(3); // only agent-rejected with score
    expect(result.would_surface).toBe(2);    // score 40 and 55 pass threshold 35
  });

  it("excludes jobs belonging to an existing experiment", () => {
    insertJob(db, { title: "PM", company_id: companyId, status: "rejected", rejected_by: "agent", score: 40 });
    insertJob(db, { title: "PM", company_id: companyId, status: "rejected", rejected_by: "agent", score: 40, experiment_id: "exp-001" });

    const result = replayThreshold(db, 35);
    expect(result.total_candidates).toBe(1);
  });

  it("excludes unscored jobs", () => {
    insertJob(db, { title: "PM", company_id: companyId, status: "rejected", rejected_by: "agent", score: undefined });

    const result = replayThreshold(db, 35, { lookbackDays: 14 });
    expect(result.total_candidates).toBe(0);
  });
});
