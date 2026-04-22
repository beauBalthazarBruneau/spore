# MCP Server Setup

## What the MCP server is and why it exists

Spore ships with a [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that gives Claude Code agents a typed, controlled interface to the SQLite database. Instead of writing raw SQL or shelling out to `sqlite3`, every agent tool call (scoring jobs, upserting profiles, listing companies, etc.) goes through this server.

This keeps the database coherent: the same dedup logic, state-machine transitions, and validation that the backend enforces are applied whether a human or an agent is writing data.

## How it is registered

`.mcp.json` is committed to the repo root:

```json
{
  "mcpServers": {
    "spore": {
      "command": "npx",
      "args": ["-y", "tsx", "backend/mcp/server.ts"]
    }
  }
}
```

Claude Code Desktop reads `.mcp.json` automatically when you open the project folder. No additional configuration is needed — the server is launched on demand when an agent first calls a `mcp__spore__*` tool.

## Prerequisites

Both `npx` and `tsx` must be available. They are installed as part of the normal dependency install:

```bash
npm run setup   # or: npm install
```

After that, `npx tsx` is runnable from any directory within the project.

## ANTHROPIC_API_KEY

The MCP server itself does not call the Anthropic API — it only talks to the local SQLite database. However, Claude Code (the host that runs agent skills) requires the key to be set in your shell environment before launch:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

Add that line to your shell profile (`~/.zshrc`, `~/.bashrc`, etc.) so it is always available. If the variable is missing, Claude Code will refuse to start agent steps.

## Troubleshooting

**MCP server fails to start in Claude Code Desktop**

Run the server manually to see the raw error output:

```bash
npx tsx backend/mcp/server.ts
```

Common causes:
- `npm install` has not been run — run `npm run setup` or `npm install` first.
- The `data/` directory does not exist — run `npm run setup` to seed it from `data.example/`.
- A syntax error was introduced in `backend/mcp/server.ts` — the manual run will show the exact line.

**Tools show as "not found" in an agent session**

Check that `.mcp.json` is present in the repo root and that you opened Claude Code from inside the repo directory (not a parent folder). Claude Code resolves `.mcp.json` relative to the workspace root.

**Permission errors on `data/autoapply.db`**

The DB file is created on first connect. If `data/` was copied with restricted permissions, fix them:

```bash
chmod -R u+rw data/
```
