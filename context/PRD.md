# Spore — PRD

> **Status:** working document. Sections marked **[decided]** are locked; **[tentative]** are proposals we haven't argued to ground yet; **[open]** are real unknowns.

## Summary
Spore is an open-source, Claude Code–driven automated job application submitter. It finds relevant roles, tailors a resume to each one, submits applications, and kicks off networking outreach — all orchestrated by Claude Code agents behind a local Next.js frontend.

## Goals
- Take a job seeker from "here's my background" to submitted applications with minimal manual effort.
- Fully open source and self-hostable; users bring their own Claude API key.
- Keep the user in the loop with a clean frontend for review, approval, and monitoring.
- Demonstrate Claude Code as the automation engine — no bespoke scraping stack, no hand-rolled LLM plumbing.

## Non-Goals
- Hosting a multi-tenant SaaS (v1 is local/self-hosted).
- Generating fabricated experience or credentials.

## Users
Job seekers who want leverage, and tinkerers who want to fork the workflow for their own automation.

---

## Architectural Principles **[decided]**

These constraints apply across all stages. Any stage design that violates them is wrong by construction.

1. **SQLite is the system of record.** `data/spore.db` (currently `autoapply.db` — rename pending). All state, including artifacts (resume md/tex/pdf, cover letters, outreach drafts), lives in the DB. Nothing on disk outside `data/`.
2. **Agents talk to the DB only through the `spore` MCP server.** No raw SQL from agents, no direct file reads of artifacts, no sqlite3 shell-out.
3. **The `jobs.status` column is the spine.** Stage transitions are status changes. The state machine is authoritative and enforced via CHECK constraint in `schema.sql`.
4. **Deterministic I/O and hard filters are code; judgment is LLM.** Fetching, deduping, rendering artifacts, submitting forms = code. Resume tailoring, fit scoring, outreach copy = LLM.
5. **Every stage emits structured events** into the `events` table so the dashboard can show what ran, when, and what happened.

---

## Core Flow

Five stages, each a Claude Code agent task or orchestrator job:

1. **Find Jobs** — discover postings matching the user's criteria. **[built]**
2. **Probe** — inspect the target application form to determine what fields exist. **[next]**
3. **Tailor** — produce a role-specific resume, plus cover letter / custom answers only when the form asks for them. **[next]**
4. **Submit** — fill and submit the employer's application form. **[later]**
5. **Network** — identify contacts and draft outreach. **[later]**
6. **Interview Prep** — research the company/interviewer when an interview is scheduled. **[tentative, scope TBD]**

See `flow.md` for the diagram.

---

## Stage 1: Find Jobs **[built]**

Current implementation (see `CLAUDE.md` for details):

- **Discover**: `orchestrate.ts --name discover-companies` scrapes funding news for recently-funded companies (output only, no DB write). `add-companies` skill enriches + upserts.
- **Fetch**: `orchestrate.ts --name discover-jobs-by-companies` pulls postings from watched companies' ATS boards (Greenhouse, Lever, Ashby, Rippling) → `status='fetched'`.
- **Prescore**: `orchestrate.ts --name prescore` computes deterministic 0–100 signal → `status='prescored'`. Never auto-rejects.
- **LLM score**: `score-jobs` agent reads `prescored`, calls `upsert_scored` MCP tool, promotes (score ≥ 60 → `new`) or demotes (→ `rejected`).
- **Swipe**: `/swipe` UI. User decisions write `approved | rejected | skipped`. Approved auto-advances to `needs_tailoring`.

Open follow-ups for this stage live in Linear backlog (Dashboard + Self-healing jobs projects).

---

## Stage 2a: Probe **[decided]**

Deterministic step that inspects the target application form **before** any LLM work, so Tailor only generates artifacts the form actually asks for.

**Trigger:** cron batch over `status='approved'`. Advances to `needs_tailoring` on success, `probe_failed` on failure.

**Status machine update:**
```
approved → probing → needs_tailoring | probe_failed
probe_failed  (manual intervention: unblock → needs_tailoring, or reject)
```

Add `probing` and `probe_failed` to the `jobs.status` CHECK constraint.

**Implementation:** `backend/probe/{greenhouse,lever,ashby,rippling,generic-playwright}.ts` with a `Prober.probe(job) → ApplicationForm` interface, registered in `backend/probe/index.ts`. Pattern mirrors `backend/sources/`.

- Known ATSes: hit public form-schema endpoints (Greenhouse/Lever/Ashby all expose these). Pure code.
- Generic (Playwright): navigate URL, enumerate form fields, call a one-shot LLM to classify unknown field labels (is this a cover letter? a custom question? a demographic?).
- Failed probe ⇒ `probe_failed` + an error note. We do **not** fall through to tailor with null form data — failed probes almost always mean submission will fail too.

**New column: `jobs.application_form_json`** (TEXT). Shape:
```json
{
  "ats": "greenhouse",
  "submission_method": "api" | "playwright" | "manual",
  "fields": {
    "resume": { "required": true, "formats": ["pdf", "docx"] },
    "cover_letter": { "required": false, "accepted": false },
    "questions": [
      { "id": "q1", "label": "Why this company?", "required": true, "max_chars": 500 },
      { "id": "q2", "label": "Work authorization", "required": true, "type": "enum", "options": ["US citizen", "..."] }
    ],
    "demographics": { "present": true, "required": false }
  }
}
```

Orchestrator stage: `orchestrate.ts --name probe-applications`. Emits `probe_applications_run` event.

---

## Stage 2b: Tailor

**Trigger [decided]:** cron batch over `status='needs_tailoring'` (which implies probe succeeded and `application_form_json` is populated). Advances to `tailored`.

**Inputs:**
- `jobs.description`, `jobs.title`, `jobs.application_form_json`, `companies.name`
- `profile.base_resume_json`, `profile.criteria_json`, `profile.preferences_json`, `profile.demographics_json`
- `question_answers` table (bank of prior approved answers — see below)

**Outputs, conditional on `application_form_json.fields`:**

| Form requirement | What tailor produces |
|---|---|
| resume | always: `jobs.resume_json` (tailored) |
| cover_letter.accepted = true | `jobs.cover_letter_md` |
| cover_letter.accepted = false | **skip** — don't burn tokens |
| custom questions | `jobs.application_answers_json` (keyed by question id) |
| demographics | auto-filled from `profile.demographics_json` at submit time (no LLM) |

**Schema changes:**
- Add `jobs.resume_json TEXT`.
- Add `profile.base_resume_json TEXT` and `profile.demographics_json TEXT`.
- Rename `jobs.application_answers_text` → `jobs.application_answers_json` (shape: `{ "q1": "answer", "q2": "answer" }`).
- Drop `jobs.resume_md` (becomes a render-on-demand preview from `resume_json`, not stored state).

**Status transitions:**
```
needs_tailoring → tailoring → tailored → ready_to_apply
                            ↳ needs_tailoring (on user reject + edit)
```

**Resume format [decided]:** structured JSON as canonical source.

- `profile.base_resume_json` is the master. `jobs.resume_json` is the per-role tailored copy.
- Renderer walks JSON → emits tex via template macros → compiles to pdf. Both cached on the row (`resume_tex`, `resume_pdf`).
- Agent edits JSON only. Renderer is pure code, deterministic, never LLM-touched.
- Validator rejects tailored JSONs that introduce new companies, roles, or education entries absent from the master — prevents fabrication.
- One-off migration script: parse `Resume_bank/config/master_resume.tex` → JSON, upsert to `profile.base_resume_json`.

**JSON schema** (excerpt — shape mirrors template macros 1:1):
```json
{
  "header": { "name": "...", "phone": "...", "location": "...", "email": "...", "linkedin": "...", "website": "..." },
  "summary": "Paragraph string.",
  "experience": [
    {
      "company": "Florence Healthcare",
      "dates": "Jun 2021 -- Jun 2025",
      "location": "",
      "roles": [{ "title": "...", "dates": "", "bullets": ["..."] }]
    }
  ],
  "education": [{ "school": "...", "location": "...", "degree": "...", "bullets": ["..."] }],
  "projects": [{ "name": "...", "dates": "...", "bullets": ["..."] }],
  "presentations": [{ "title": "...", "year": "..." }],
  "skills": [{ "category": "Product", "items": "..." }]
}
```

Dates stored as display strings (not date objects). LaTeX escaping happens in the renderer, not the agent.

**Render pipeline:** `backend/render/resume.ts` exposes `jsonToTex(resume) → string` and `renderPdf(tex) → Buffer` (subprocess to `pdflatex`). Rendering is a post-step after `upsert_tailored` writes `resume_json` — a render failure keeps the job in `tailoring` with an error note so the agent doesn't advance to `tailored` with a broken artifact. pdflatex is a documented system dependency.

**Agent pattern:**
- New agent `.claude/agents/tailor.md` analogous to `score-jobs.md`.
- Reads `status='needs_tailoring'` via MCP, one job at a time.
- Writes artifacts via a new MCP tool `upsert_tailored(job_id, resume_json, cover_letter_md?, application_answers_json?, review_text?)` — advances status after successful render.
- Logs a `tailor_run` event.

**Review gate:**
Board card detail shows: rendered resume md preview, pdf download, cover letter md (if any), per-question answers (if any). Actions: "approve" → `ready_to_apply`, "re-tailor" → `needs_tailoring` with a user note that the agent reads on retry.

---

## Question-answer bank **[decided]**

Recurring application questions ("why this company", "work authorization", "years of React", "salary expectations") should be answered once and reused, not regenerated from scratch per application.

**New table:**
```sql
CREATE TABLE question_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint TEXT NOT NULL UNIQUE,         -- normalized question (lowercased, stripped punctuation, stemmed)
  label TEXT NOT NULL,                      -- canonical form shown to user
  answer_text TEXT NOT NULL,
  is_reusable INTEGER NOT NULL DEFAULT 1,   -- 0 for company-specific answers ("why THIS company?")
  source TEXT NOT NULL CHECK (source IN ('user','agent')),  -- who authored it
  approved INTEGER NOT NULL DEFAULT 0,      -- 1 = user has approved for reuse
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  last_used_job_id INTEGER REFERENCES jobs(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Flow:**
- Tailor agent, for each question in `application_form_json.fields.questions`:
  1. Compute fingerprint.
  2. Look up in `question_answers` where `is_reusable=1 AND approved=1`. If hit → reuse verbatim, increment `use_count`.
  3. Miss → generate answer, store in `question_answers` with `source='agent'`, `approved=0`, `is_reusable=` (agent-decided based on whether the answer references the company).
  4. Write the resolved answer to `jobs.application_answers_json[question_id]`.
- On Board review, the user can edit answers. Edits propagate back to `question_answers` with `source='user'`, `approved=1` — next application with the same question uses the approved answer.

**MCP tools:** `list_question_answers`, `upsert_question_answer` (for the tailor agent; the UI uses direct DB access).

**Frontend surface:** a `/answers` page to review, edit, approve, and delete entries in the bank. Not urgent for v1 — initial seed comes from tailor output.

---

## Demographics **[decided]**

- New column: `profile.demographics_json`. User-supplied, never LLM-generated.
- Auto-filled at submit time when `application_form_json.fields.demographics.present = true`. Never during tailor (no tokens burned).
- Keys expected to match the stable set most ATSes use (gender, race/ethnicity, veteran status, disability status). Each field individually optional — absent key means "prefer not to say".

---

## Stage 3: Submit

**The highest-risk stage. Failures are reputationally expensive (wrong resume sent, duplicate applications, broken form answers).**

**Trigger [decided]:** cron batch over `ready_to_apply` jobs. Per-application confirmation step before any network call that actually submits.

**Submission strategy [decided]:** hybrid.
1. **ATS JSON API** where available (Greenhouse, Lever, Ashby expose public application endpoints). Deterministic, cheap, fast.
2. **Playwright browser automation** for everything else. Not `claude-in-chrome` — we want headless, scripted, CI-friendly.
3. **Flag-for-manual** when (a) the ATS isn't one of the above, (b) required fields can't be auto-filled, or (c) submission fails after N retries.

**CAPTCHA:** in scope. Expect to handle via a solver service (2Captcha / Anti-Captcha) as a dependency. Bring-your-own key, same as the Claude API key.

**Status transitions:**
```
ready_to_apply → applying → applied
                         ↳ submission_blocked (needs new status)
```

Add `submission_blocked` to the CHECK constraint. From there user can manually complete and mark `applied`, or send back to `needs_tailoring`.

**Idempotency:**
- Never submit to the same `(source, source_job_id)` twice.
- Track `submitted_at` + `confirmation_ref` before any retry.
- Dry-run mode that exercises the full pipeline (fill form, don't click submit) — essential for testing per employer.

**Architecture [tentative]:**
- New directory `backend/submit/` with per-ATS submitters (`greenhouse.ts`, `lever.ts`, ...) implementing `Submitter.submit(job, profile) → SubmitResult`.
- `backend/submit/playwright.ts` for the generic fallback: takes a URL + a field-mapping heuristic + the cached `application_answers_text`.
- New MCP tool `mark_submitted(job_id, confirmation_ref, method)` — only callable by the submit agent, writes `submitted_at`, advances status.
- New orchestrator stage `submit-applications`.

**Review gate:**
- Per-application: after form is filled but before submit, the UI shows a preview. User clicks "submit" → actual POST.
- Batch mode (optional, later): pre-approved applications can submit without the per-card gate.

---

## Stage 4: Network

**Branches off after `applied` (or in parallel).** Not a job status — a sibling pipeline.

**New tables [tentative]:**
```sql
CREATE TABLE contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES companies(id),
  name TEXT NOT NULL,
  title TEXT,
  linkedin_url TEXT UNIQUE,
  email TEXT,
  source TEXT,                  -- 'linkedin' | 'manual' | 'referral'
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE outreach (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  job_id INTEGER REFERENCES jobs(id),   -- nullable: contact can exist independent of a job
  draft_md TEXT,
  channel TEXT,                  -- 'linkedin_dm' | 'email' | 'other'
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','approved','sent','replied','no_reply'
  )),
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Discovery:**
- LinkedIn is the primary source and it's gated. Options: (a) Playwright-driven with user's own session cookie, (b) manual paste-in, (c) a LinkedIn API if we can get one. Needs its own scoping discussion.
- GitHub as a fallback for eng roles — public profiles, no auth needed.

**Drafting:**
- Agent `.claude/agents/outreach.md` reads a `contact` + optionally a linked `job` → drafts a message → writes `outreach.draft_md`.
- User reviews in a new `/network` UI, edits, approves, sends (manual copy-paste in v1; automated later).

**Decoupled from jobs pipeline** on purpose — you can warm up a company before applying, or keep outreach going after a rejection.

---

## Stage 5: Interview Prep **[tentative, scope TBD]**

Triggered when a job moves to `interview_invite`. An agent produces a prep doc (company news, interviewer background if provided, likely questions, your relevant projects to highlight).

**Stored as:** `jobs.interview_prep_md` (new column).

**Open:** whether this is v1 or v1.5. Low-risk to build, but requires the earlier stages to actually be shipping applications first.

---

## Frontend

Next.js 14 on port 3100. Current pages: `/swipe`, `/board`, `/companies`, `/profile`, `/stats`. Adds needed:
- `/board` card detail: artifact preview (resume md, cover letter), approve/retailor/submit actions.
- `/network` (new): contacts + outreach kanban.
- `/stats`: add funnel/calibration/yield views (see Linear Dashboard project).

---

## Success Metrics
- Time from criteria-set to first submitted application < 10 minutes.
- ≥ 80% of tailored resumes accepted by user without edits.
- Easy one-command local setup.
- Submission success rate ≥ 95% on supported ATSes (dry-run → real submit parity).

---

## Open Questions

- **CAPTCHA solver**: which service (2Captcha / Anti-Captcha / other), what's the fallback when solver fails?
- **LinkedIn scraping approach for Network**: Playwright + user cookie feels right but carries TOS risk. Acceptable?
- **Interview Prep scope**: v1 or later?
- **DB rename**: `autoapply.db` → `spore.db`? (Low-stakes migration, worth doing soon before artifacts pile up.)
- **Dry-run UX**: where does the dry-run artifact live — a separate row, a flag, a log event?
- **Answer-bank fingerprinting**: how aggressive should the normalization be? Too loose → wrong answers matched. Too strict → no matches, bank is useless.
