# Find Jobs — Planning

Scheduled run (via Claude Code desktop cron) that produces **≥10 review-worthy jobs** per execution, written to the `jobs` table with `status='new'` for the Swipe page.

## Design principle: code where it's deterministic, AI where it's judgment

| Concern | Code | AI (Claude) |
|---|---|---|
| HTTP fetch, pagination, rate-limit, retries | ✅ | |
| HTML/JSON → structured posting (per-board scraper) | ✅ | fallback only |
| Dedup against `jobs(source, source_job_id)` + URL | ✅ | |
| Hard filters (location, remote, salary floor, exclusions) | ✅ | |
| Soft scoring / fit judgment against profile + resume | | ✅ |
| Decline reasons in human language | | ✅ |
| Query expansion ("staff eng" → variants, synonyms) | | ✅ |
| Scheduling, DB writes, logging to `events` | ✅ | |
| Deciding when to stop / broaden search to hit 10 | | ✅ (orchestrator) |

Rule of thumb: if two runs with the same input should produce the same output, it's code. If it requires reading a JD against a resume, it's Claude.

## Architecture

```
cron (claude code desktop)
   └─▶ find-jobs agent (Claude)
          ├─ MCP: get_profile, get_criteria, get_base_resume
          ├─ MCP: search_board(source, query)  ◀── per-board scrapers in code
          ├─ MCP: upsert_job(...)              ◀── dedup + hard filters in code
          ├─ Claude: score_and_explain(job, resume, criteria)
          └─ loop until ≥10 jobs with score ≥ threshold, or sources exhausted
```

The agent is the orchestrator. It calls deterministic MCP tools for I/O and uses its own reasoning for scoring and query strategy.

## Per-board scrapers (code)

Yes — build them. Generic scraping via Claude is slow, expensive, and brittle on structured boards that already expose clean data.

**Tier 1 (structured APIs, cheap + reliable):**
- **Greenhouse** — public JSON at `boards-api.greenhouse.io/v1/boards/{company}/jobs`. Per-company; we maintain a company list.
- **Lever** — public JSON at `api.lever.co/v0/postings/{company}`. Same pattern.
- **Ashby** — public GraphQL-ish endpoint per company.

**Tier 2 (aggregators):**
- **YC Work at a Startup** — has a usable feed.
- **Hacker News "Who is hiring"** — monthly thread, parse via HN API + Claude for unstructured posts.
- **RemoteOK / WeWorkRemotely** — RSS/JSON feeds.

**Tier 3 (gated / ToS-sensitive):**
- **LinkedIn, Indeed** — defer. Logged-in scraping is a rabbit hole and violates ToS. Revisit with user-supplied session cookies later, or skip.

Each scraper: `search(query, criteria) → RawPosting[]` with a normalized shape. Keep them small; one file per source under `backend/sources/`.

**Company list for GH/Lever/Ashby**: seed a `companies_watchlist` file (yaml) the user edits. Claude can suggest additions from criteria.

## Scoring

Two-stage so we don't spend tokens on obvious misses.

**Stage 1 — hard filters (code, in `upsert_job`):**
- Location / remote policy mismatch → reject
- Salary below floor (if posted) → reject
- Hard exclusions (see below) → reject
- Already in DB (by url or source+source_job_id) → skip

### Hard exclusions

Stored on `profile.criteria_json.exclusions` and applied deterministically before scoring — Claude never sees these jobs, so no tokens burned and no risk of the model "rescuing" one.

```json
"exclusions": {
  "companies": ["Palantir", "Meta", ...],       // case-insensitive exact match on company name
  "company_domains": ["example.com"],            // catches rebrands / subsidiaries
  "title_keywords": ["intern", "manager", "sales"], // substring, case-insensitive
  "description_keywords": ["on-site only", "secret clearance"],
  "industries": ["defense", "gambling", "crypto"], // matched against company tags where available
  "locations": ["NYC"],                          // if user wants to veto specific metros
  "seniority": ["junior", "principal"],          // if detectable from title
  "visa_required": true                          // reject postings that require sponsorship the user doesn't have, etc.
}
```

Each reason gets logged to `jobs.decline_reason` so excluded postings are still auditable — they're inserted with `status='rejected'` rather than dropped silently, which prevents re-scoring them on the next cron run and gives the Stats page something to show.

**Stage 2 — soft score (Claude, per surviving job):**
Claude returns `{ score: 0-100, reasons: string[], decline_reason?: string }` given the JD + base resume + criteria.

Suggested rubric (in the agent prompt, not code):
- 40 pts — title/seniority match
- 25 pts — skills overlap with resume
- 15 pts — domain/industry interest per `preferences_json`
- 10 pts — comp signal (explicit band, equity, etc.)
- 10 pts — company quality heuristics (stage, notable investors, etc.)

Threshold for "review-worthy": **score ≥ 60**. Tune after first few runs.

Batch scoring: pass 5–10 JDs per Claude call to amortize tokens.

## Hitting the "≥10 jobs" target

Agent loop:
1. Pull criteria + watchlist.
2. For each source, fetch latest postings.
3. Hard-filter + dedup → candidate pool.
4. Score candidates in batches.
5. If `count(score≥60) < 10`:
   - Broaden query (Claude suggests variants),
   - Or pull more pages,
   - Or lower threshold to 50 and flag in notes.
6. Write survivors as `jobs.status='new'` with `score` + `decline_reason`.
7. Log run summary to `events` (sources hit, counts, final threshold used).

## Scheduling

- Claude Code desktop cron runs the `find-jobs` agent daily (e.g. 7am).
- Agent is idempotent — dedup prevents re-inserting old postings.
- Failure mode: write an `events` row with `action='find_jobs_failed'` and partial counts; don't crash the cron.

## Open questions
- Watchlist bootstrap: hand-curated, or scraped from a "companies I'd work at" list Claude builds from criteria?
- Do we store the raw scraped JSON (`raw_json` col already planned) for every posting, or only survivors?
- Batch size + model choice for scoring (Haiku for stage 2? Sonnet if score is borderline?).
- LinkedIn — worth the ToS / auth pain, or skip permanently?

## First milestone
1. `backend/sources/greenhouse.ts` + `lever.ts` with a shared `RawPosting` type.
2. `mcp/tools/search_board.ts`, `upsert_job.ts` (with hard filters + dedup).
3. `.claude/agents/find-jobs.md` — prompt with rubric, loop instructions, target=10.
4. Seed `data/companies_watchlist.yaml` with ~30 companies.
5. Dry run; tune threshold; then wire to cron.
