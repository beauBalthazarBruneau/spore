# AutoApply Data Model — Plan

## Context
AutoApply is an open-source, Claude Code–driven job application automator (see `PRD.md`, `flow.md`). The four agent stages — Find Jobs → Tailor Resume → Submit → Network / Interview Prep — need a shared data layer that (a) Claude agents read/write via tool calls, (b) a frontend reads/writes via a local API, (c) scales past the point where markdown-per-job becomes filler, and (d) contains zero personal data in the repo itself.

Decision: **SQLite + an MCP server** as the single system of record. Generated artifacts (tailored resumes, cover letters, rendered PDFs) live *in* the database — markdown as TEXT, PDFs as BLOB. Only the user's hand-maintained base resume lives on disk.

## Decisions
- **Stack**: TypeScript / Node for MCP server and local API.
- **Frontend**: Next.js (keeps a clean path to a hosted SaaS later).
- **Scope**: Single-user schema now; revisit `user_id` columns when we go hosted.
- **Companies**: Dedicated `companies` table from day one.
- **Search criteria**: Stored on the profile row (`criteria_json`) — single active search for v1.
- **Jobs + Applications merged**: One `jobs` table carries the full lifecycle from discovery to offer/rejection.
- **Simplified v1**: No dedicated tables for contacts, outreach, or interview_prep. Networking and prep agents write freeform into `jobs.notes` and `events`. Add tables later if those flows grow.

## Data Model

### Directory layout
```
./data/                     # gitignored
  autoapply.db              # SQLite file — holds everything generated
  base/
    resume.md               # user's master resume (hand-edited)
    resume.pdf              # optional hand-supplied PDF
    profile.json            # name, contact, links, prefs, criteria
./data.example/             # committed, fake data for new users
                              # seeded from /Users/beau/Documents/dev/Resume_bank/dashboard/data/resumebank.db
                              # (postings + applications joined → jobs rows; PII scrubbed before commit)
```

### Tables

**profile** — single row, the user's identity + active search criteria
- `id`, `full_name`, `email`, `phone`, `location`, `links_json`, `base_resume_path`, `preferences_json`
- `criteria_json` — `{ titles, locations, keywords, exclusions, salary_min, remote_pref }`
- `updated_at`

**companies** — deduped employer records
- `id`, `name` (unique, case-insensitive), `domain`, `linkedin_url`, `notes`, `created_at`

**jobs** — single table for discovery + application lifecycle
- Discovery: `id`, `source` (linkedin/greenhouse/lever/…), `source_job_id`, `url` (unique), `title`, `company_id` FK, `location`, `remote`, `salary_min`, `salary_max`, `posted_at`, `discovered_at`, `description` TEXT, `raw_json`, `score` (0–100), `decline_reason`
- Lifecycle: `status` — flattened from `resume_bank`'s two-table model (postings + applications) into one enum:
  - Discovery (pre-approval, Swipe page): `new`, `approved`, `rejected`, `skipped`
  - Application lifecycle (post-approval, Board page): `needs_tailoring`, `tailoring`, `tailored`, `ready_to_apply`, `applied`, `interview_invite`, `declined`, `on_hold`
  - Transition: when a job is `approved` on Swipe, it auto-advances to `needs_tailoring` to enter the Board.
- `rejection_reason`, `rejection_note` (from postings); `pipeline_step`, `outcome` (from applications)
- Application fields (null until pursued): `resume_md` TEXT, `resume_pdf` BLOB, `resume_pdf_mime`, `cover_letter_md` TEXT, `cover_letter_pdf` BLOB, `cover_letter_pdf_mime`, `submitted_at`, `confirmation_ref`, `notes`
- `updated_at`
- Indexes: `status`, `(source, source_job_id)` unique

**events** — append-only audit log (timeline for the frontend, memory for Claude; also where Network/Interview Prep agents write for now)
- `id`, `entity_type`, `entity_id`, `action`, `actor` (`claude`/`user`/`system`), `payload_json`, `created_at`

## MCP Server

The MCP server wraps the DB with typed tools — one small, purpose-built tool per read/write operation the agents need. Each agent's instructions whitelist only the tools it's allowed to call. The frontend talks to the same SQLite file through Next.js API route handlers and streams PDFs out of BLOB columns.

Exact tool list is defined in `mcp/schema.ts` at implementation time, not here.

## Frontend Pages (Next.js)

- **Swipe** (`/swipe`) — Tinder-style. One card per `jobs.status = 'new'`, shows title/company/location/salary/description excerpt. Swipe right → `approved` (then auto-advances to `needs_tailoring`), left → `rejected` (prompts for `rejection_reason`), up/skip → `skipped`. Keyboard: ←/→/↑.
- **Board** (`/board`) — Kanban across application-lifecycle columns: `needs_tailoring` → `tailoring` → `tailored` → `ready_to_apply` → `applied` → `interview_invite`. Side lanes / collapsed: `declined`, `on_hold`. Drag cards between columns to update `status`.
- **Profile** (`/profile`) — Edit `profile` row + `criteria_json` (titles, locations, keywords, exclusions, salary, remote). Upload/replace base resume (writes to `./data/base/resume.md` + `.pdf`).
- **Stats** (`/stats`) — Counts per status, applications per week, response rate (submitted → interviewing), top companies, declined reasons histogram. Pulls from `jobs` and `events`.

All pages hit Next.js route handlers that query SQLite directly (same file the MCP server writes to). Job detail drawer/modal is shared across Swipe and Board — shows tailored resume MD, lets user trigger Tailor/Submit agents, streams stored PDFs.

## Critical files to create
- `PRD.md` — extend with a "Data Model" section pointing here
- `.gitignore` — add `data/`
- `data.example/` — seed fake `profile.json`, `base/resume.md`, sample jobs
- `mcp/` — MCP server package (schema migrations + tool handlers)
- `mcp/schema.sql` — DDL for the tables above
- `mcp/pdf.ts` — markdown → PDF renderer (`md-to-pdf` or headless Chromium via `puppeteer`)
- `agents/` — markdown instructions per agent (find-jobs.md, tailor-resume.md, submit.md, network.md, interview-prep.md)
- `frontend/` — Next.js app

## Verification (once implemented)
- `sqlite3 data/autoapply.db < mcp/schema.sql` creates all tables; `PRAGMA foreign_keys=ON;` enforced.
- MCP server boots and `tools/list` returns the tool surface above.
- Fresh clone → `cp -r data.example data && npm run mcp` → agent can `list_jobs` and get the seeded rows.
- End-to-end smoke: Find Jobs agent against a mocked source populates `jobs`; Tailor agent writes `resume_md` on a job row; `render_pdf` populates `resume_pdf` BLOB; frontend API route streams the PDF with correct mime type.
