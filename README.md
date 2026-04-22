# Spore

**A local, Claude Code–powered job application automator**

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Node: 18+](https://img.shields.io/badge/Node-18%2B-green.svg)
[CI: coming soon]

---

## What it is

Spore finds relevant job postings, scores them with a Claude Code agent, and presents them for your approval in a Tinder-style swipe UI. Right swipe = interested, left swipe = pass. Approved jobs move into a Kanban board where Claude Code agents tailor your resume and cover letter to each specific role.

It runs entirely locally — your data stays on your machine in a single SQLite file. You bring your own Claude API key; there is no Spore cloud, no account, no telemetry.

Built as a reference implementation showing how Claude Code agents can automate complex multi-step workflows against a local SQLite database. The codebase is intentionally readable: one state-machine table, typed MCP tools for agent↔DB communication, and a Next.js frontend that talks to the same SQLite file through server components.

---

## Pipeline overview

```
┌─────────────────────────────────────────────────────────────┐
│  1. Find Jobs   │  Discover postings from Greenhouse, Lever, │
│                 │  and Ashby ATS boards for companies you    │
│                 │  watch. Hard-filtered and prescored by     │
│                 │  deterministic rules before LLM scoring.   │
├─────────────────┼────────────────────────────────────────────┤
│  2. Swipe       │  Review AI-scored postings in a card UI.   │
│                 │  Right = approved → moves to Board.        │
│                 │  Left = rejected → stored for stats.       │
├─────────────────┼────────────────────────────────────────────┤
│  3. Tailor      │  Claude Code generates a role-specific     │
│                 │  resume and cover letter for each approved │
│                 │  job. You review before anything is sent.  │
├─────────────────┼────────────────────────────────────────────┤
│  4. Apply       │  Review tailored docs on the Board, then   │
│                 │  mark ready to apply or on hold.           │
└─────────────────┴────────────────────────────────────────────┘
```

All state lives in `data/autoapply.db`. The pipeline is a one-way state machine: `fetched → prescored → new → approved → needs_tailoring → tailoring → tailored → ready_to_apply → applied`.

---

## Screenshots / Demo

> Screenshots and a demo GIF will be added once the tailoring pipeline ships.

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| **Node 18+** | Check with `node --version` |
| **Claude API key** | [Get one at console.anthropic.com](https://console.anthropic.com) |
| **Claude Code** | `npm install -g @anthropic-ai/claude-code` |
| **SQLite** | Bundled via `better-sqlite3` — no separate install needed |

---

## Quick start

```bash
git clone https://github.com/beauBalthazarBruneau/spore.git
cd spore
ANTHROPIC_API_KEY=your_key_here npm run setup
npm run dev
# Open http://localhost:3100
```

The setup script installs dependencies, initialises the database, and seeds `data/` with example jobs and profile data so you can explore the UI immediately without running any pipeline stages first.

---

## Configuration

**API key and environment variables**

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

The three variables you'll likely need:

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Required for LLM scoring and tailoring |
| `AUTOAPPLY_DB` | Override the default `data/autoapply.db` path |
| `PORT` | Override the default frontend port (3100) |

**Your profile**

After first launch, visit `http://localhost:3100/profile` to fill in your work history, target roles, and preferences. The LLM scoring agent reads this to evaluate fit.

**Watched companies**

The Companies page (`http://localhost:3100/companies`) lets you add ATS boards to watch. Spore supports Greenhouse, Lever, Ashby, and Rippling. Add a company name and its ATS slug — Spore will probe the board to confirm it is reachable before saving.

---

## Running the pipelines

### Find jobs

Pull fresh postings from all watched companies' ATS boards:

```bash
npx tsx backend/orchestrate.ts --name discover-jobs-by-companies
```

This fetches postings, applies hard filters (title mismatch, seniority, etc.), and writes survivors as `status='fetched'`. Filtered-out postings are saved with a rejection reason rather than dropped silently.

### Discover new companies to watch

Scrape TechCrunch and Google News RSS for recently-funded companies:

```bash
npx tsx backend/orchestrate.ts --name discover-companies
# Optional flags:
#   --months 3          how far back to look
#   --rounds seed,a,b   funding rounds to include
#   --sector ai,devtools sector filter
```

This outputs candidates but does not write to the DB. Use the `add-companies` skill in Claude Code to enrich and save them.

### Score pending jobs

Run the `score-jobs` agent from Claude Code Desktop or CLI. The agent reads all `status='prescored'` rows, scores each with judgment, and promotes jobs (score ≥ 60) to `status='new'` so they appear in the Swipe UI.

```bash
# Inside Claude Code:
# /score-jobs
```

### Prescore (deterministic pre-filter)

Advance all `fetched` postings to `prescored` using rule-based scoring:

```bash
npx tsx backend/orchestrate.ts --name prescore
```

This runs automatically as part of `discover-jobs-by-companies` but can be run standalone.

---

## Development

### Running tests

```bash
# Backend (vitest)
npm test

# Frontend (vitest + jsdom + React Testing Library)
npm --workspace frontend test

# Single backend test file
npx vitest run backend/prescore.test.ts
```

### Project structure

```
spore/
├── backend/
│   ├── db.ts               # SQLite connection + migrations (backend)
│   ├── schema.sql          # Authoritative schema
│   ├── prescore.ts         # Deterministic 0–100 scoring
│   ├── filters.ts          # Hard-rejection filters
│   ├── fetchers/
│   │   ├── watched.ts      # ATS fetch orchestration
│   │   └── discover/       # Company discovery from funding news
│   ├── sources/            # Per-ATS adapters (greenhouse, lever, ashby, rippling)
│   └── mcp/
│       └── server.ts       # MCP server — the only DB channel for agents
├── frontend/
│   ├── app/                # Next.js App Router pages + API routes
│   └── lib/
│       ├── db.ts           # SQLite connection (frontend, same schema)
│       └── types.ts        # Shared job-status types
├── context/
│   ├── PRD.md              # Product requirements + architecture overview
│   ├── FIND_JOBS_PLAN.md   # LLM scoring rubric + pipeline design
│   └── tailor-pipeline-plan.md
└── data/                   # gitignored; data.example/ is committed
```

### Architecture notes

- **Single SQLite file, two TypeScript entry points.** `backend/db.ts` is used by the MCP server and orchestrator; `frontend/lib/db.ts` is used by Next.js server components and API routes. Both apply the same schema on connect.
- **Agents only talk to the DB via MCP.** `backend/mcp/server.ts` exposes narrow, purpose-built tools (`list_jobs`, `upsert_scored`, etc.). No raw SQL from agents.
- **Dedup key is `(source, source_job_id) OR url`.** Postings are never duplicated across runs.
- **Migrations are additive.** `ALTER TABLE` only; destructive reshapes use rename-recreate-copy. Migrations live in both `db.ts` copies — keep them in sync.

### Adding an ATS source

1. Create `backend/sources/<name>.ts` implementing `SourceAdapter.search(opts) → RawPosting[]`
2. Register it in `backend/sources/index.ts`

### Adding a pipeline stage

1. Create a module exporting `run(db) → Promise<Report>`
2. Add it to the `fetchers` map in `backend/orchestrate.ts`

### Further reading

| Document | What it covers |
|----------|---------------|
| `context/PRD.md` | Full product requirements and architecture |
| `context/FIND_JOBS_PLAN.md` | LLM scoring rubric, prescore formula |
| `context/tailor-pipeline-plan.md` | Resume/cover letter tailoring design |
| `CONTRIBUTING.md` | Branch naming, PR process, MCP notes |
| `backend/schema.sql` | Canonical DB schema and status CHECK constraint |

---

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup steps, branch naming conventions, PR expectations, and notes on working with the MCP server.

---

## License

MIT — see [`LICENSE`](LICENSE)
