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
  singleton = db;
  return db;
}

export const DB_FILE = DB_PATH;
