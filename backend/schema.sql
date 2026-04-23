PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  full_name TEXT,
  email TEXT,
  phone TEXT,
  location TEXT,
  links_json TEXT,
  base_resume_md TEXT,
  preferences_json TEXT,
  criteria_json TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  domain TEXT,
  linkedin_url TEXT,
  ats_source TEXT,                        -- 'greenhouse' | 'lever' | 'ashby' | 'rippling' | null (null = manually tracked)
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
  prescore REAL,
  score REAL,
  match_explanation TEXT,

  -- lifecycle
  -- Pre-Swipe:    fetched → prescored (deterministic scoring) → new|rejected (LLM-scored)
  -- Swipe values: new | approved | rejected | skipped
  -- Board values: needs_tailoring | tailoring | tailored | ready_to_apply | applied | interview_invite | declined | on_hold
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
    'fetched','prescored',
    'new','approved','rejected','skipped',
    'needs_tailoring','tailoring','tailored','ready_to_apply','applied','interview_invite','declined','on_hold'
  )),
  rejection_reason TEXT,
  rejection_note TEXT,
  rejected_by TEXT CHECK (rejected_by IN ('filter','agent','user') OR rejected_by IS NULL),
  approval_reason TEXT,
  approval_note TEXT,
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

-- Custom questions detected on the application form during the tailoring probe.
-- field_selector is stored so the submitter can target the field directly without re-detecting.
CREATE TABLE IF NOT EXISTS application_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  question TEXT NOT NULL,
  answer TEXT,
  field_type TEXT,       -- 'text' | 'textarea' | 'select' | 'checkbox' | 'radio'
  field_selector TEXT,   -- stable CSS selector (prefer name attr) for submitter reuse
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_application_questions_job ON application_questions(job_id);

-- Tracks companies surfaced by the discover stage so they aren't re-shown.
CREATE TABLE IF NOT EXISTS discovered_candidates (
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  dismissed INTEGER NOT NULL DEFAULT 0
);
