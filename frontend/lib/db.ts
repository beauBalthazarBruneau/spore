import "server-only";
import Database from "better-sqlite3";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
export type { Job, JobStatus } from "./types";
export { SWIPE_STATUS, BOARD_COLUMNS, BOARD_SIDE } from "./types";
import type { Job, JobStatus } from "./types";

// Frontend runs from ./frontend so the repo root is one level up.
const REPO_ROOT = resolve(process.cwd(), "..");
const DB_PATH = process.env.AUTOAPPLY_DB ?? resolve(REPO_ROOT, "data/autoapply.db");
const SCHEMA_PATH = resolve(REPO_ROOT, "mcp/schema.sql");

declare global {
  // eslint-disable-next-line no-var
  var __autoapply_db: Database.Database | undefined;
}

export function getDb(): Database.Database {
  if (global.__autoapply_db) return global.__autoapply_db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  if (existsSync(SCHEMA_PATH)) db.exec(readFileSync(SCHEMA_PATH, "utf8"));
  global.__autoapply_db = db;
  return db;
}

const JOB_SELECT = `
  SELECT j.id, j.title, c.name AS company, j.location, j.salary_range, j.url, j.source,
         j.description, j.score, j.match_explanation, j.status,
         j.rejection_reason, j.rejection_note, j.notes,
         j.resume_tex, j.cover_letter_md, j.submitted_at, j.discovered_at, j.updated_at
  FROM jobs j LEFT JOIN companies c ON c.id = j.company_id
`;

export function listJobs(status?: JobStatus | JobStatus[]): Job[] {
  const db = getDb();
  if (!status) return db.prepare(`${JOB_SELECT} ORDER BY j.discovered_at DESC, j.id DESC`).all() as Job[];
  const arr = Array.isArray(status) ? status : [status];
  const placeholders = arr.map(() => "?").join(",");
  return db
    .prepare(`${JOB_SELECT} WHERE j.status IN (${placeholders}) ORDER BY j.discovered_at DESC, j.id DESC`)
    .all(...arr) as Job[];
}

export function getJob(id: number): Job | undefined {
  return getDb().prepare(`${JOB_SELECT} WHERE j.id = ?`).get(id) as Job | undefined;
}

export function updateJob(id: number, patch: Partial<Job> & { actor?: "user" | "claude" | "system" }) {
  const db = getDb();
  const current = getJob(id);
  if (!current) throw new Error(`no job ${id}`);

  // When Swipe sets status='approved', auto-advance into the Board.
  let nextStatus = patch.status ?? current.status;
  if (patch.status === "approved") nextStatus = "needs_tailoring";

  const fields: string[] = [];
  const values: any[] = [];
  const writable: (keyof Job)[] = ["rejection_reason", "rejection_note", "notes"];
  for (const k of writable) {
    if (patch[k] !== undefined) { fields.push(`${k} = ?`); values.push(patch[k]); }
  }
  fields.push(`status = ?`); values.push(nextStatus);
  fields.push(`updated_at = datetime('now')`);
  db.prepare(`UPDATE jobs SET ${fields.join(", ")} WHERE id = ?`).run(...values, id);

  db.prepare(
    `INSERT INTO events (entity_type, entity_id, action, actor, payload_json) VALUES ('job', ?, ?, ?, ?)`,
  ).run(
    id,
    `status:${current.status}->${nextStatus}`,
    patch.actor ?? "user",
    JSON.stringify({ from: current.status, to: nextStatus, rejection_reason: patch.rejection_reason ?? null }),
  );
  return getJob(id)!;
}

export function getProfile() {
  const row = getDb().prepare(`SELECT * FROM profile WHERE id = 1`).get() as any;
  if (!row) return null;
  return {
    ...row,
    links_json: row.links_json ? JSON.parse(row.links_json) : {},
    preferences_json: row.preferences_json ? JSON.parse(row.preferences_json) : {},
    criteria_json: row.criteria_json ? JSON.parse(row.criteria_json) : {},
  };
}

export function statusCounts() {
  return getDb().prepare(`SELECT status, COUNT(*) AS n FROM jobs GROUP BY status`).all() as { status: JobStatus; n: number }[];
}
