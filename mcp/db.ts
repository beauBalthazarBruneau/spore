import Database from "better-sqlite3";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..");
const DB_PATH = process.env.AUTOAPPLY_DB ?? resolve(REPO_ROOT, "data/autoapply.db");
const SCHEMA_PATH = resolve(REPO_ROOT, "mcp/schema.sql");

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
  db.exec(`CREATE INDEX IF NOT EXISTS idx_companies_watching ON companies(watching) WHERE watching = 1`);
}

export const DB_FILE = DB_PATH;
