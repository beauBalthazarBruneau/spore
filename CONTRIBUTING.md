# Contributing to Spore

## Prerequisites

- **Node 18+** — check with `node --version`
- **tsx** — installed as a devDependency (`npx tsx` works without a global install)
- **SQLite** — the `sqlite3` CLI is handy for direct DB inspection; the app itself uses `better-sqlite3` via npm

## Clone and setup

```bash
git clone https://github.com/beauBalthazarBruneau/spore.git
cd spore
npm run setup   # installs root + frontend dependencies
npm run dev     # starts Next.js on port 3100
```

The SQLite database (`data/autoapply.db`) is created automatically on first run. Schema and migrations are applied by `backend/db.ts` and `frontend/lib/db.ts` on connect — no manual migration step needed.

## Running tests

Backend (vitest, run from repo root):

```bash
npm test
```

Run a single file:

```bash
npx vitest run backend/prescore.test.ts
```

Frontend (vitest + jsdom + React Testing Library):

```bash
npm --workspace frontend test
```

## Branch naming

| Context | Convention |
|---|---|
| Linear ticket | `worktree-spore-NNN` (e.g. `worktree-spore-25`) |
| Other feature | `feature/short-description` |
| Bug fix | `fix/short-description` |

## Pull request expectations

- One PR per ticket.
- Target ~300 lines of change; split larger work into stacked PRs.
- All CI checks must pass before merge.
- Include a short description of what changed and why, plus a test plan checklist.

## MCP server

The MCP server (`backend/mcp/server.ts`) is the only channel agents use to talk to the database. It is configured in `.mcp.json` and launched automatically by Claude Code — you do not need to start it manually. If you add a new MCP tool, update the tool allowlist in `.claude/settings.json`.

```bash
# To run it manually for debugging:
npx tsx backend/mcp/server.ts
```

## Environment variables

Copy `.env.example` to `.env` at the repo root (and optionally to `frontend/.env.local` for frontend-specific overrides):

```bash
cp .env.example .env
```

The `ANTHROPIC_API_KEY` env var is **required** for any Claude-powered agent step (LLM scoring, skills, etc.). Without it, agent commands will fail. Get a key at [console.anthropic.com](https://console.anthropic.com).

See `.env.example` for the full list of supported variables.
