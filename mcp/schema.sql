PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  full_name TEXT,
  email TEXT,
  phone TEXT,
  location TEXT,
  links_json TEXT,
  base_resume_path TEXT,
  preferences_json TEXT,
  criteria_json TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  domain TEXT,
  linkedin_url TEXT,
  ats_source TEXT,                        -- 'greenhouse' | 'lever' | 'ashby' | null (null = manually tracked)
  ats_slug TEXT,                          -- board identifier on that ATS
  watching INTEGER NOT NULL DEFAULT 0,    -- 1 = include in scheduled find-jobs fetch
  archived INTEGER NOT NULL DEFAULT 0,    -- 1 = hidden from default companies view
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- idx_companies_watching created by migrate() in db.ts to remain idempotent on pre-existing DBs.

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- discovery
  source TEXT,
  source_job_id TEXT,
  url TEXT UNIQUE,
  title TEXT NOT NULL,
  company_id INTEGER REFERENCES companies(id),
  location TEXT,
  remote TEXT,
  salary_min INTEGER,
  salary_max INTEGER,
  salary_range TEXT,
  posted_at TEXT,
  discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
  description TEXT,
  raw_json TEXT,
  score REAL,
  match_explanation TEXT,

  -- lifecycle: flattened from resume_bank postings + applications
  -- Pre-Swipe:    fetched (passed hard filters, not yet Claude-scored)
  -- Swipe values: new | approved | rejected | skipped
  -- Board values: needs_tailoring | tailoring | tailored | ready_to_apply | applied | interview_invite | declined | on_hold
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
    'fetched',
    'new','approved','rejected','skipped',
    'needs_tailoring','tailoring','tailored','ready_to_apply','applied','interview_invite','declined','on_hold'
  )),
  rejection_reason TEXT,
  rejection_note TEXT,
  pipeline_step TEXT,
  outcome TEXT,

  -- application artifacts (null until pursued)
  resume_md TEXT,
  resume_tex TEXT,
  resume_pdf BLOB,
  resume_pdf_mime TEXT,
  cover_letter_md TEXT,
  cover_letter_pdf BLOB,
  cover_letter_pdf_mime TEXT,
  application_answers_text TEXT,
  outreach_text TEXT,
  review_text TEXT,
  review_verdict TEXT,
  submitted_at TEXT,
  confirmation_ref TEXT,
  notes TEXT,

  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_source ON jobs(source, source_job_id) WHERE source_job_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('claude','user','system')),
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_entity ON events(entity_type, entity_id);
