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
const SCHEMA_PATH = resolve(REPO_ROOT, "backend/schema.sql");

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
  migrate(db);
  global.__autoapply_db = db;
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

  const jobCols = db.prepare(`PRAGMA table_info(jobs)`).all() as Array<{ name: string }>;
  const jobColNames = new Set(jobCols.map((c) => c.name));
  if (!jobColNames.has("prescore")) db.exec(`ALTER TABLE jobs ADD COLUMN prescore REAL`);

  const profCols = db.prepare(`PRAGMA table_info(profile)`).all() as Array<{ name: string }>;
  const profNames = new Set(profCols.map((c) => c.name));
  if (profNames.has("base_resume_path") && !profNames.has("base_resume_md")) {
    db.exec(`ALTER TABLE profile RENAME COLUMN base_resume_path TO base_resume_md`);
  }
  if (!profNames.has("base_resume_md") && !profNames.has("base_resume_path")) {
    db.exec(`ALTER TABLE profile ADD COLUMN base_resume_md TEXT`);
  }
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

export interface CompanyRow {
  id: number;
  name: string;
  ats_source: string | null;
  ats_slug: string | null;
  watching: 0 | 1;
  archived: 0 | 1;
  domain: string | null;
  linkedin_url: string | null;
  notes: string | null;
  jobs_discovered: number;
  jobs_applied: number; // applied | interview_invite | declined
  last_discovered_at: string | null;
}

export function listCompanies(opts: { includeArchived?: boolean } = {}): CompanyRow[] {
  const where = opts.includeArchived ? "" : "WHERE c.archived = 0";
  return getDb()
    .prepare(
      `SELECT c.id, c.name, c.ats_source, c.ats_slug, c.watching, c.archived,
              c.domain, c.linkedin_url, c.notes,
              COUNT(j.id) AS jobs_discovered,
              SUM(CASE WHEN j.status IN ('applied','interview_invite','declined') THEN 1 ELSE 0 END) AS jobs_applied,
              MAX(j.discovered_at) AS last_discovered_at
         FROM companies c
         LEFT JOIN jobs j ON j.company_id = c.id
         ${where}
         GROUP BY c.id
         ORDER BY c.watching DESC, jobs_applied DESC, c.name COLLATE NOCASE ASC`,
    )
    .all() as CompanyRow[];
}

export function upsertCompany(patch: {
  name: string;
  ats_source?: string | null;
  ats_slug?: string | null;
  watching?: 0 | 1;
  domain?: string | null;
  linkedin_url?: string | null;
  notes?: string | null;
}): CompanyRow {
  const db = getDb();
  db.prepare(
    `INSERT INTO companies (name, ats_source, ats_slug, watching, domain, linkedin_url, notes)
     VALUES (@name, @ats_source, @ats_slug, @watching, @domain, @linkedin_url, @notes)
     ON CONFLICT(name) DO UPDATE SET
       ats_source = COALESCE(excluded.ats_source, companies.ats_source),
       ats_slug = COALESCE(excluded.ats_slug, companies.ats_slug),
       watching = COALESCE(excluded.watching, companies.watching),
       domain = COALESCE(excluded.domain, companies.domain),
       linkedin_url = COALESCE(excluded.linkedin_url, companies.linkedin_url),
       notes = COALESCE(excluded.notes, companies.notes),
       archived = 0`,
  ).run({
    name: patch.name,
    ats_source: patch.ats_source ?? null,
    ats_slug: patch.ats_slug ?? null,
    watching: patch.watching ?? 0,
    domain: patch.domain ?? null,
    linkedin_url: patch.linkedin_url ?? null,
    notes: patch.notes ?? null,
  });
  return getCompany(patch.name)!;
}

export function getCompany(nameOrId: string | number): CompanyRow | undefined {
  const q = `SELECT c.id, c.name, c.ats_source, c.ats_slug, c.watching, c.archived,
                    c.domain, c.linkedin_url, c.notes,
                    COUNT(j.id) AS jobs_discovered,
                    SUM(CASE WHEN j.status IN ('applied','interview_invite','declined') THEN 1 ELSE 0 END) AS jobs_applied,
                    MAX(j.discovered_at) AS last_discovered_at
               FROM companies c LEFT JOIN jobs j ON j.company_id = c.id
               WHERE ${typeof nameOrId === "number" ? "c.id = ?" : "c.name = ? COLLATE NOCASE"}
               GROUP BY c.id`;
  return getDb().prepare(q).get(nameOrId) as CompanyRow | undefined;
}

export function patchCompany(
  id: number,
  patch: Partial<Pick<CompanyRow, "ats_source" | "ats_slug" | "watching" | "archived" | "domain" | "linkedin_url" | "notes">>,
): CompanyRow {
  const db = getDb();
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (keys.length === 0) return getCompany(id)!;
  const sets = keys.map((k) => `${k} = @${k}`).join(", ");
  db.prepare(`UPDATE companies SET ${sets} WHERE id = @id`).run({ id, ...patch });
  return getCompany(id)!;
}

export function statusCounts() {
  return getDb().prepare(`SELECT status, COUNT(*) AS n FROM jobs GROUP BY status`).all() as { status: JobStatus; n: number }[];
}
