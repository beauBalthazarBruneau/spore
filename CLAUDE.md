# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Spore (package name `autoapply`) is a local, self-hosted job-application automator. The sqlite DB is the system of record; Claude Code agents and a Next.js UI both read and write the same SQLite file through typed interfaces. Claude code agents use an MCP server to interact with the db exclusively.

Product context (PRD, flow diagrams, per-project plans) lives in [`context/`](./context/README.md). Read that before starting any non-trivial work — the status tags tell you what's `[decided]` vs `[open]`.

## Commands

Root (backend / orchestrators / scripts):
- `npm test` — vitest over `backend/**/*.test.ts`
- `npx vitest run backend/prescore.test.ts` — run a single backend test file
- `npx tsx backend/orchestrate.ts --name discover-companies [--months 3] [--rounds seed,a,b] [--sector ai,devtools]` — scrape funding news for recently-funded companies, output candidates (does not write to DB)
- `npx tsx backend/orchestrate.ts --name discover-jobs-by-companies` — fetch postings from watched companies' ATS boards → `status='fetched'`
- `npx tsx backend/orchestrate.ts --name prescore` — deterministic prescore over `status='fetched'` → `status='prescored'`
- `npx tsx backend/mcp/server.ts` — run the `spore` MCP server over stdio (normally launched by `.mcp.json`)

Frontend (`frontend/` workspace, also reachable from root as `npm run dev`):
- `npm run dev` (root) or `npm --workspace frontend run dev` — Next.js on port **3100**
- `npm --workspace frontend test` — vitest with jsdom + React Testing Library
- `npm --workspace frontend run build` / `start`

Direct DB inspection: `sqlite3 data/autoapply.db`. Schema in `backend/schema.sql`; both `backend/db.ts` and `frontend/lib/db.ts` run `schema.sql` + inline migrations on first connect, so applying schema is never manual.

## Architecture

### Single SQLite file, two TypeScript entry points

`data/autoapply.db` is opened by:
1. **Backend** (`backend/db.ts`) — used by the MCP server, fetchers, and orchestrator. Path is resolved relative to repo root.
2. **Frontend** (`frontend/lib/db.ts`) — used by Next.js route handlers and server components. Path is resolved from `process.cwd()/..` because Next.js runs inside `frontend/`. Uses `globalThis` to survive hot reload.

Both modules apply the same schema + migrations on connect. Keep them in sync: if you add a migration to one, add it to the other, or factor it out. `process.env.AUTOAPPLY_DB` overrides the path in both.

### The jobs.status pipeline (single table, state machine)

`jobs.status` is the spine of the system. Statuses split into three phases; the CHECK constraint in `schema.sql` is authoritative:

```
fetched → prescored → new | rejected          (pre-Swipe, populated by code + LLM)
new → approved | rejected | skipped           (Swipe)
approved → needs_tailoring → tailoring → tailored → ready_to_apply → applied
                                            ↓
                           interview_invite | declined | on_hold
```

- **Fetchers** (`backend/fetchers/watched.ts`) pull from ATS adapters, apply hard filters (`backend/filters.ts`), dedup on `(source, source_job_id) OR url`, and insert survivors as `status='fetched'`. Filtered-out postings are written with `status='rejected'` + `rejection_reason` — never dropped silently (prevents re-scoring next run).
- **Prescore** (`backend/prescore.ts`) computes a deterministic 0–100 signal from title match, keyword overlap, seniority, comp signal, and recency. **Never auto-rejects** — every `fetched` row advances to `prescored` so the LLM sees the full picture.
- **LLM scoring** (`.claude/agents/score-jobs.md`) reads `status='prescored'`, scores with judgment, and calls `upsert_scored` which promotes (`→ new`, score ≥ 60) or demotes (`→ rejected`).
- **Swipe UI** (`/swipe`) writes `approved` and the frontend auto-advances to `needs_tailoring` (`updateJob` in `frontend/lib/db.ts`) so the Board picks it up.

The **code-vs-LLM boundary** is explicit: deterministic I/O, dedup, hard filters, and prescoring are code; fit judgment and decline reasons are the LLM. See `FIND_JOBS_PLAN.md` for the rubric.

### MCP server (`backend/mcp/server.ts`)

The only channel agents use to talk to the DB — no raw SQL from agents. Registered in `.mcp.json` and launched on demand by Claude Code. Tools are intentionally narrow and purpose-built per agent need:

- `get_profile` / `upsert_profile` — profile singleton (id=1), JSON fields parsed on read, stringified on write, partial COALESCE updates
- `upsert_company` — creates/updates by name (case-insensitive). If `watching=true` with an ATS slug, **probes the ATS first**; probe failure forces `watching=0` and returns a warning
- `probe_ats` — read-only reachability check against a source adapter
- `list_jobs` — flat shape with joined `company_name`, optionally filtered by status
- `upsert_scored` — id-based update, applies threshold (default 60), logs a `score_jobs_run` event
- `add_jobs` — manual insert path that bypasses fetch/prescore, auto-creating companies

When adding tools: keep them small; return `ok(data)` / `err(msg)` via the local helpers; the allowlist in `.claude/settings.json` must be updated for new tool names.

### ATS source adapters (`backend/sources/`)

Per-ATS adapters implement `SourceAdapter.search(opts) → RawPosting[]`: `greenhouse`, `lever`, `ashby`, `rippling`. Registered in `sources/index.ts` — adding a source means adding a file there and registering it. Each adapter returns `RawPosting.company_name = ats_slug`; `watched.ts` remaps to the canonical company name before upsert. Gated boards (LinkedIn, Indeed) are intentionally out of scope.

### Orchestrator pattern

`backend/orchestrate.ts` is the single entry point for scheduled / cron-triggered stages. Each stage is a module exporting `run(db) → Promise<Report>`. Every run logs a `{name}_fetch_run` event with counts + duration; errors are caught, logged, and exit non-zero. New deterministic stages plug in by adding a module and entry to the `fetchers` map.

- **`discover-companies`** (`backend/fetchers/discover/`) — scrapes TechCrunch + Google News RSS feeds for recently-funded companies (Seed/A/B by default). Outputs candidates but does **not** write to the DB — the `add-companies` skill handles enrichment and upsert. Supports `--months`, `--rounds`, and `--sector` CLI flags. Dedupes against previously surfaced candidates via `discovered_candidates` table.
- **`discover-jobs-by-companies`** (`backend/fetchers/watched.ts`) — fetches jobs from watched companies' ATS boards, applies hard filters, writes survivors as `status='fetched'`. Also handles stale job cleanup (marks removed postings) and auto-archives companies with 5+ consecutive empty fetches.

### Frontend (`frontend/`)

Next.js 14 App Router on port 3100. Pages: `/swipe`, `/board`, `/companies`, `/profile`, `/stats`. Server components query SQLite directly via `frontend/lib/db.ts`; API routes under `frontend/app/api/{jobs,companies,profile}` handle mutations. Shared job-status types live in `frontend/lib/types.ts` (`SWIPE_STATUS`, `BOARD_COLUMNS`, `BOARD_SIDE`). dnd-kit drives the Board kanban.

### Skills and agents

- `.claude/agents/score-jobs.md` — the LLM scoring loop; the canonical example of "how an agent talks to the DB only via MCP tools"
- `.claude/skills/{onboard,add-jobs,add-companies}/SKILL.md` — user-invocable skills exposed via the Skill tool

## Conventions worth knowing

- **Never bypass the MCP server from an agent.** No raw SQL, no `sqlite3` shell-out. The one-table state machine only stays coherent if writes go through `upsertJob` / `upsert_scored` / the typed tools.
- **Dedup key is `(source, source_job_id) OR url`.** `upsertJob` checks this before insert; adapters must populate `source_job_id` (or set `source='manual'` with the URL as the id, like `add_jobs` does).
- **Hard-filter rejections are saved, not dropped.** Written with `status='rejected'` + `rejection_reason` so Stats can show them and they're not re-scored.
- **Migrations live in `db.ts` `migrate()` (both copies).** Additive ALTERs only; destructive reshapes use the rename-recreate-copy pattern already in place for the `jobs.status` CHECK constraint.
- **`data/` is gitignored; `data.example/` is committed.** Never commit real data.
