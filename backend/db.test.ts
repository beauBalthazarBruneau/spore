import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { backfillRejectedBy } from "./db";

function setupDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(readFileSync(resolve(__dirname, "schema.sql"), "utf8"));
  // Column is in schema.sql; no separate migration needed here
  return db;
}

function insertRejectedJob(db: Database.Database, id: number, reason: string | null): void {
  db.prepare(`INSERT INTO companies (id, name) VALUES (?, ?)`).run(id, `co${id}`);
  db.prepare(
    `INSERT INTO jobs (id, title, company_id, status, rejection_reason)
     VALUES (?, ?, ?, 'rejected', ?)`,
  ).run(id, `Job ${id}`, id, reason);
}

function insertEvent(db: Database.Database, jobId: number, actor: string): void {
  db.prepare(
    `INSERT INTO events (entity_type, entity_id, action, actor)
     VALUES ('job', ?, 'status:new->rejected', ?)`,
  ).run(jobId, actor);
}

function rejectedBy(db: Database.Database, id: number): string | null {
  const row = db.prepare(`SELECT rejected_by FROM jobs WHERE id = ?`).get(id) as
    | { rejected_by: string | null }
    | undefined;
  return row?.rejected_by ?? null;
}

describe("backfillRejectedBy — event-based classification", () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it("maps actor='user' to 'user'", () => {
    insertRejectedJob(db, 1, "wrong_location");
    insertEvent(db, 1, "user");
    backfillRejectedBy(db);
    expect(rejectedBy(db, 1)).toBe("user");
  });

  it("maps actor='claude' to 'agent'", () => {
    insertRejectedJob(db, 2, "Music industry domain, no AI alignment");
    insertEvent(db, 2, "claude");
    backfillRejectedBy(db);
    expect(rejectedBy(db, 2)).toBe("agent");
  });

  it("maps actor='system' to 'filter'", () => {
    insertRejectedJob(db, 3, "title excluded keyword");
    insertEvent(db, 3, "system");
    backfillRejectedBy(db);
    expect(rejectedBy(db, 3)).toBe("filter");
  });

  it("uses the most recent rejected event when multiple exist", () => {
    insertRejectedJob(db, 4, "reason");
    insertEvent(db, 4, "system");
    insertEvent(db, 4, "claude");
    backfillRejectedBy(db);
    expect(rejectedBy(db, 4)).toBe("agent");
  });
});

describe("backfillRejectedBy — heuristic fallback when no event exists", () => {
  let db: Database.Database;
  beforeEach(() => { db = setupDb(); });

  it("maps user-preset reasons to 'user'", () => {
    const presets = ["wrong_location", "salary_too_low", "role_mismatch", "posting_not_found", "other"];
    for (let i = 0; i < presets.length; i++) {
      insertRejectedJob(db, 10 + i, presets[i]);
    }
    backfillRejectedBy(db);
    for (let i = 0; i < presets.length; i++) {
      expect(rejectedBy(db, 10 + i)).toBe("user");
    }
  });

  it("maps filter-style reasons to 'filter'", () => {
    const samples = [
      "title excluded keyword",
      "excluded seniority",
      "salary 100000 below floor 140000",
      "posting removed from ATS",
      "location 'Paris' not in accepted locations",
    ];
    for (let i = 0; i < samples.length; i++) {
      insertRejectedJob(db, 20 + i, samples[i]);
    }
    backfillRejectedBy(db);
    for (let i = 0; i < samples.length; i++) {
      expect(rejectedBy(db, 20 + i)).toBe("filter");
    }
  });

  it("maps free-text LLM reasons to 'agent'", () => {
    insertRejectedJob(db, 30, "Clinical finance domain too specialized; not core product/AI fit");
    insertRejectedJob(db, 31, "Very senior role at Anthropic requiring research-product intersection");
    backfillRejectedBy(db);
    expect(rejectedBy(db, 30)).toBe("agent");
    expect(rejectedBy(db, 31)).toBe("agent");
  });

  it("leaves rejected_by null when rejection_reason is null", () => {
    insertRejectedJob(db, 40, null);
    backfillRejectedBy(db);
    expect(rejectedBy(db, 40)).toBeNull();
  });
});

describe("backfillRejectedBy — does not touch already-set rows", () => {
  it("skips jobs that already have rejected_by set", () => {
    const db = setupDb();
    insertRejectedJob(db, 50, "something");
    db.prepare(`UPDATE jobs SET rejected_by = 'agent' WHERE id = ?`).run(50);
    // Add an event that would normally flip to 'user'
    insertEvent(db, 50, "user");
    backfillRejectedBy(db);
    expect(rejectedBy(db, 50)).toBe("agent");
  });

  it("leaves non-rejected jobs alone", () => {
    const db = setupDb();
    db.prepare(`INSERT INTO companies (id, name) VALUES (99, 'co99')`).run();
    db.prepare(
      `INSERT INTO jobs (id, title, company_id, status) VALUES (99, 'Job', 99, 'new')`,
    ).run();
    backfillRejectedBy(db);
    expect(rejectedBy(db, 99)).toBeNull();
  });
});
