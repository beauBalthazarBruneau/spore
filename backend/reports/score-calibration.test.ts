import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  bucketize,
  pearson,
  loadUserDecidedJobs,
  buildReport,
} from "./score-calibration";

function setupDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(readFileSync(resolve(__dirname, "../schema.sql"), "utf8"));
  return db;
}

function insertJob(
  db: Database.Database,
  opts: {
    id: number;
    status: string;
    prescore?: number | null;
    score?: number | null;
    rejected_by?: string | null;
  },
): void {
  db.prepare(`INSERT OR IGNORE INTO companies (id, name) VALUES (?, ?)`).run(
    opts.id, `co${opts.id}`,
  );
  db.prepare(
    `INSERT INTO jobs (id, title, company_id, status, prescore, score, rejected_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.id,
    `Job ${opts.id}`,
    opts.id,
    opts.status,
    opts.prescore ?? null,
    opts.score ?? null,
    opts.rejected_by ?? null,
  );
}

describe("loadUserDecidedJobs", () => {
  it("includes jobs in post-approval statuses", () => {
    const db = setupDb();
    insertJob(db, { id: 1, status: "needs_tailoring", prescore: 50, score: 70 });
    insertJob(db, { id: 2, status: "applied", prescore: 60, score: 80 });
    const labels = loadUserDecidedJobs(db);
    expect(labels).toHaveLength(2);
    expect(labels.every((l) => l.approved)).toBe(true);
  });

  it("includes user-rejected jobs", () => {
    const db = setupDb();
    insertJob(db, { id: 1, status: "rejected", rejected_by: "user", score: 40 });
    const labels = loadUserDecidedJobs(db);
    expect(labels).toHaveLength(1);
    expect(labels[0].approved).toBe(false);
  });

  it("excludes filter and agent rejections", () => {
    const db = setupDb();
    insertJob(db, { id: 1, status: "rejected", rejected_by: "filter", score: 30 });
    insertJob(db, { id: 2, status: "rejected", rejected_by: "agent", score: 50 });
    expect(loadUserDecidedJobs(db)).toHaveLength(0);
  });

  it("excludes skipped and still-queued jobs", () => {
    const db = setupDb();
    insertJob(db, { id: 1, status: "skipped", score: 60 });
    insertJob(db, { id: 2, status: "new", score: 70 });
    insertJob(db, { id: 3, status: "prescored", score: null });
    expect(loadUserDecidedJobs(db)).toHaveLength(0);
  });

  it("includes rescued near-misses (status flipped past rejected)", () => {
    // User approved an agent-rejected job — status moves to needs_tailoring,
    // rejected_by may still be 'agent'. Should count as approved.
    const db = setupDb();
    insertJob(db, {
      id: 1, status: "needs_tailoring", rejected_by: "agent", score: 72,
    });
    const labels = loadUserDecidedJobs(db);
    expect(labels).toHaveLength(1);
    expect(labels[0].approved).toBe(true);
  });
});

describe("bucketize", () => {
  const mk = (score: number, approved: boolean) => ({
    prescore: score, score, approved,
  });

  it("bins into 10-wide buckets", () => {
    const buckets = bucketize(
      [mk(5, true), mk(15, false), mk(95, true)],
      "score",
    );
    expect(buckets).toHaveLength(10);
    expect(buckets[0].approved).toBe(1);
    expect(buckets[1].rejected).toBe(1);
    expect(buckets[9].approved).toBe(1);
  });

  it("computes approval rate per bucket", () => {
    const buckets = bucketize(
      [mk(55, true), mk(52, false), mk(58, true), mk(51, false)],
      "score",
    );
    expect(buckets[5].approved).toBe(2);
    expect(buckets[5].rejected).toBe(2);
    expect(buckets[5].rate).toBe(0.5);
  });

  it("clamps score=100 into the top bucket", () => {
    const buckets = bucketize([mk(100, true)], "score");
    expect(buckets[9].approved).toBe(1);
  });

  it("drops null scores", () => {
    const buckets = bucketize(
      [
        { prescore: null, score: null, approved: true },
        mk(55, true),
      ],
      "score",
    );
    const total = buckets.reduce((a, b) => a + b.approved + b.rejected, 0);
    expect(total).toBe(1);
  });
});

describe("pearson", () => {
  const mk = (score: number, approved: boolean) => ({
    prescore: score, score, approved,
  });

  it("returns ~1 for perfect positive correlation", () => {
    const labels = [mk(10, false), mk(30, false), mk(70, true), mk(90, true)];
    expect(pearson(labels, "score")).toBeGreaterThan(0.9);
  });

  it("returns ~-1 for perfect negative correlation", () => {
    const labels = [mk(10, true), mk(30, true), mk(70, false), mk(90, false)];
    expect(pearson(labels, "score")).toBeLessThan(-0.9);
  });

  it("returns ~0 for random scores", () => {
    const labels = [mk(50, true), mk(50, false), mk(50, true), mk(50, false)];
    expect(pearson(labels, "score")).toBe(0); // zero variance in x
  });

  it("returns 0 with fewer than 2 samples", () => {
    expect(pearson([mk(50, true)], "score")).toBe(0);
  });

  it("ignores null scores when computing correlation", () => {
    const labels = [
      mk(10, false), mk(90, true),
      { prescore: null, score: null, approved: true },
    ];
    expect(pearson(labels, "score")).toBeGreaterThan(0.9);
  });
});

describe("buildReport", () => {
  it("summarises a mixed data set", () => {
    const db = setupDb();
    insertJob(db, { id: 1, status: "needs_tailoring", prescore: 70, score: 75 });
    insertJob(db, { id: 2, status: "applied", prescore: 80, score: 85 });
    insertJob(db, { id: 3, status: "rejected", rejected_by: "user", prescore: 40, score: 45 });
    insertJob(db, { id: 4, status: "rejected", rejected_by: "filter", prescore: 30, score: null });
    insertJob(db, { id: 5, status: "skipped", prescore: 50, score: 50 });

    const r = buildReport(db);
    expect(r.total_user_decisions).toBe(3);
    expect(r.approved).toBe(2);
    expect(r.user_rejected).toBe(1);
    expect(r.prescore_samples).toBe(3);
    expect(r.llm_score_samples).toBe(3);
    // Higher scores → approved, lower → rejected, so correlation should be positive
    expect(r.prescore_correlation).toBeGreaterThan(0.5);
    expect(r.llm_score_correlation).toBeGreaterThan(0.5);
  });

  it("handles empty data", () => {
    const db = setupDb();
    const r = buildReport(db);
    expect(r.total_user_decisions).toBe(0);
    expect(r.prescore_correlation).toBe(0);
  });
});
