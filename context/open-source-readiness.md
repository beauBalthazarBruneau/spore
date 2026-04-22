# Open-Source Readiness Checklist

> Spore will be published once the job-finder and tailoring pipelines are both complete and stable. This doc tracks everything else that needs to land before the repo goes public.

---

## Blocking: pipeline completion

These must be done before anything else matters.

- [ ] **Tailoring pipeline** — Probe + Tailor stages as specced in `tailor-pipeline-plan.md`. The job-finder pipeline is done; tailoring is the remaining core feature.
- [ ] **Resume render** — markdown → PDF in-DB (needed for tailored output to be usable). Depends on tailoring.

---

## Repo hygiene

- [ ] **README.md** — the current one in `context/` is a planning doc, not a user-facing readme. The repo root needs a proper README with: what Spore is, a screenshot or demo GIF, one-command setup, and a link to the full docs.
- [ ] **LICENSE** — no license file exists. Choose and add one (MIT is the obvious pick for a self-hosted tool).
- [ ] **CONTRIBUTING.md** — brief guide: how to run tests, branch naming, PR expectations.
- [ ] **`.env.example`** — document every env var the user needs to set (Claude API key, any port overrides). The frontend has a `.env` that is gitignored but never explained.
- [ ] **Clean up `PLAN.md`** — it references `/Users/beau/Documents/dev/Resume_bank/...` (a local path). Strip personal paths before making the repo public.
- [ ] **`.next/` in gitignore** — confirm the frontend build artifact folder is fully gitignored (currently it leaks into `.next/types/` which contains a path reference to `/Users/beau`).

---

## Onboarding experience

A new user should be able to clone, run one command, and have Spore working with example data. Right now that path has gaps.

- [ ] **Setup script or `npm run setup`** — copies `data.example/` → `data/`, installs deps, starts the dev server. Should detect missing Claude API key and print a clear message.
- [ ] **MCP config docs** — `.mcp.json` is committed but uses `npx tsx`, which requires `tsx` installed. Document the bootstrap requirement; ideally the setup script handles it.
- [ ] **`data.example/` completeness audit** — verify the seeded jobs + profile are sufficient for a new user to experience the full Swipe → Board flow without needing to run a fetch first.
- [ ] **Onboard skill polish** — the `onboard` skill currently assumes the user's context (Beau's resume format, etc.). Make it generic and point to the example profile as a starting template.

---

## Security / privacy

- [ ] **No personal data in committed files** — audit `data.example/`, `context/`, and all `.md` files for real names, emails, phone numbers, or employer names. `data.example/profile.json` looks clean; double-check `data.example/base/resume.md`.
- [ ] **API key handling** — confirm the Claude API key is never logged, never written to the DB, and never appears in `events` payloads.
- [ ] **`data/` gitignore** — already in place; verify with `git check-ignore data/autoapply.db` before first push.

---

## Quality gates

- [ ] **Test coverage for prescore and filters** — these are the deterministic core; they have tests but coverage should be checked before public scrutiny lands.
- [ ] **CI** — no CI config exists. Add a minimal GitHub Actions workflow: `npm test` + `npm --workspace frontend test` on push to main. Keeps the "it works on a fresh clone" guarantee honest.
- [ ] **`data.example/` integrity test** — a test or smoke script that opens `data.example/` as the DB and verifies schema + seed rows load without errors.

---

## Nice-to-have (not blocking)

- [ ] Linear / project tracking cleanup — internal ticket references in commit messages are fine; make sure no internal URLs or workspace names appear in code comments or docs.
- [ ] Cron setup docs — the desktop cron integration isn't documented anywhere a new user would find it.
- [ ] Demo video or screenshots in README — significantly increases adoption for a tool like this.
