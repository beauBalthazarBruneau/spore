# context/

Working docs for planning and architecture. This is the human-readable source of truth for **what we're building and why**. Linear tickets and code are downstream of what lives here.

## What lives here

- **`PRD.md`** — the product requirements doc. Covers every stage of the pipeline at the architecture level. Sections are tagged `[decided]`, `[tentative]`, or `[open]`.
- **`flow.md`** — the high-level and detailed mermaid diagrams of the end-to-end flow. Stays in sync with `PRD.md`.
- **`<project-slug>-plan.md`** — per-project breakdowns that turn a PRD section into a sequence of ticket-sized units of work with an explicit dependency graph. One file per Linear project.
- **Architecture notes** — ad-hoc `.md` files for deep dives on a single subsystem (schema design, render pipeline, probe dispatch, etc.). Name them `<topic>.md`.

## What does NOT live here

- Implementation details that belong in code comments or the code itself.
- Ticket-sized task lists (those are Linear).
- Ephemeral notes from a single chat session (those are just in chat).
- `CLAUDE.md`-style codebase guidance (that stays at repo root so it's auto-loaded).

## Conventions

- **Status tags** on sections: `[decided]` = locked, `[tentative]` = proposed but not argued through, `[open]` = real unknown. Keeps the doc usable as a working document without losing track of what's settled.
- **Relative links between files** — these docs are read together; link freely.
- **Keep it short.** If a doc passes ~500 lines, it's probably two docs.
- **Update in place, don't fork.** If a decision changes, edit the doc. Git history is the audit trail.
- **No emojis** (matches repo style).

## When to add a new doc

- Adding a new stage or subsystem to the product → update `PRD.md` and `flow.md`; create a `<slug>-plan.md` when you're ready to slice it into tickets.
- Doing a deep architecture dive that doesn't fit cleanly into the PRD → new `<topic>.md` at this level, and link to it from the PRD section it elaborates on.
- Starting a new Linear project → new `<project-slug>-plan.md`, drafted and reviewed here before tickets get created.

## Current docs

- [`PRD.md`](./PRD.md) — product requirements (all stages)
- [`flow.md`](./flow.md) — end-to-end flow diagrams
- [`tailor-pipeline-plan.md`](./tailor-pipeline-plan.md) — project plan for Stages 2a (Probe) + 2b (Tailor)
