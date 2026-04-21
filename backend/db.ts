import Database from "better-sqlite3";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..");
const DB_PATH = process.env.AUTOAPPLY_DB ?? resolve(REPO_ROOT, "data/autoapply.db");
const SCHEMA_PATH = resolve(REPO_ROOT, "backend/schema.sql");

let singleton: Database.Database | null = null;

export function getDb(): Database.Database {
  if (singleton) return singleton;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(SCHEMA_PATH, "utf8"));
  migrate(db);
  singleton = db;
  return db;
}

function migrate(db: Database.Database) {
  const cols = db.prepare(`PRAGMA table_info(companies)`).all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("ats_source")) db.exec(`ALTER TABLE companies ADD COLUMN ats_source TEXT`);
  if (!names.has("ats_slug")) db.exec(`ALTER TABLE companies ADD COLUMN ats_slug TEXT`);
  if (!names.has("watching")) db.exec(`ALTER TABLE companies ADD COLUMN watching INTEGER NOT NULL DEFAULT 0`);
  if (!names.has("archived")) db.exec(`ALTER TABLE companies ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`);
  if (!names.has("consecutive_empty_fetches")) db.exec(`ALTER TABLE companies ADD COLUMN consecutive_empty_fetches INTEGER NOT NULL DEFAULT 0`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_companies_watching ON companies(watching) WHERE watching = 1`);

  // jobs column migrations
  const jobCols = db.prepare(`PRAGMA table_info(jobs)`).all() as Array<{ name: string }>;
  const jobColNames = new Set(jobCols.map((c) => c.name));
  if (!jobColNames.has("prescore")) db.exec(`ALTER TABLE jobs ADD COLUMN prescore REAL`);
  if (!jobColNames.has("rejected_by")) {
    db.exec(`ALTER TABLE jobs ADD COLUMN rejected_by TEXT`);
    backfillRejectedBy(db);
  }
  if (!jobColNames.has("approval_reason")) db.exec(`ALTER TABLE jobs ADD COLUMN approval_reason TEXT`);
  if (!jobColNames.has("approval_note")) db.exec(`ALTER TABLE jobs ADD COLUMN approval_note TEXT`);

  // profile column migrations
  const profCols = db.prepare(`PRAGMA table_info(profile)`).all() as Array<{ name: string }>;
  const profNames = new Set(profCols.map((c) => c.name));
  if (profNames.has("base_resume_path") && !profNames.has("base_resume_md")) {
    db.exec(`ALTER TABLE profile RENAME COLUMN base_resume_path TO base_resume_md`);
  }
  if (!profNames.has("base_resume_md") && !profNames.has("base_resume_path")) {
    db.exec(`ALTER TABLE profile ADD COLUMN base_resume_md TEXT`);
  }

  // Rebuild jobs table if the CHECK constraint is missing required statuses.
  const jobsDdl = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='jobs'`)
    .get() as { sql: string } | undefined;
  const requiredStatuses = ["'fetched'", "'prescored'"];
  if (jobsDdl && requiredStatuses.some((s) => !jobsDdl.sql.includes(s))) {
    db.exec(`
      BEGIN;
      ALTER TABLE jobs RENAME TO jobs__old;
    `);
    // Recreate by re-running schema.sql (CREATE TABLE IF NOT EXISTS already ran above,
    // but the rename made it absent) — import the canonical DDL by re-reading schema.
    const schemaSql = readFileSync(SCHEMA_PATH, "utf8");
    db.exec(schemaSql);
    const oldCols = (db.prepare(`PRAGMA table_info(jobs__old)`).all() as Array<{ name: string }>)
      .map((c) => c.name);
    const newCols = (db.prepare(`PRAGMA table_info(jobs)`).all() as Array<{ name: string }>)
      .map((c) => c.name);
    const shared = oldCols.filter((c) => newCols.includes(c)).join(",");
    db.exec(`
      INSERT INTO jobs (${shared}) SELECT ${shared} FROM jobs__old;
      DROP TABLE jobs__old;
      COMMIT;
    `);
  }
}

/** Backfill the rejected_by column on existing rejected jobs using event history.
 *  - rejections with actor='user' → 'user'
 *  - rejections with actor='system' → 'filter' (hard-filter pre-Swipe rejections)
 *  - rejections with actor='claude' → 'agent' (LLM score-jobs agent)
 *  Jobs with no event (legacy rows) fall back to heuristics on rejection_reason. */
export function backfillRejectedBy(db: Database.Database) {
  const USER_REASONS = ["wrong_location", "salary_too_low", "role_mismatch", "posting_not_found", "other"];
  const FILTER_HINTS = ["excluded", "below floor", "posting removed", "not in accepted locations"];

  const rows = db
    .prepare(`SELECT id, rejection_reason FROM jobs WHERE status = 'rejected' AND rejected_by IS NULL`)
    .all() as Array<{ id: number; rejection_reason: string | null }>;

  const actorFor = db.prepare(
    `SELECT actor FROM events
     WHERE entity_type = 'job' AND entity_id = ? AND action LIKE 'status:%->rejected'
     ORDER BY id DESC LIMIT 1`,
  );
  const update = db.prepare(`UPDATE jobs SET rejected_by = ? WHERE id = ?`);

  const tx = db.transaction(() => {
    for (const row of rows) {
      const event = actorFor.get(row.id) as { actor: string } | undefined;
      let rejectedBy: string | null = null;
      if (event) {
        rejectedBy = event.actor === "user" ? "user" : event.actor === "claude" ? "agent" : "filter";
      } else {
        // No event — use rejection_reason heuristics
        const reason = row.rejection_reason?.toLowerCase() ?? "";
        if (USER_REASONS.includes(row.rejection_reason ?? "")) rejectedBy = "user";
        else if (FILTER_HINTS.some((h) => reason.includes(h))) rejectedBy = "filter";
        else if (reason) rejectedBy = "agent"; // LLM wrote a free-text reason
      }
      if (rejectedBy) update.run(rejectedBy, row.id);
    }
  });
  tx();
}

export const DB_FILE = DB_PATH;
