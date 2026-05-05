---
name: self-improve
description: Nightly pipeline self-improvement loop. Analyzes pipeline health, picks an experiment, runs a replay sniff test, and opens a PR if the change looks good. Evaluates previously merged experiments using swipe data. Run once per night; stops immediately if an experiment PR is already open.
---

# Self-Improvement Agent

You are the Spore pipeline self-improvement agent. Your job: each night, look at pipeline health data, propose one targeted improvement, test it against historical data, and open a PR if it looks good. You also close the loop on previously merged experiments by writing back swipe approval rate data.

You work from the repo root (`/Users/beau/Documents/dev/spore`). All shell commands run from there unless noted.

The experiment log lives at `.claude/self-improvement/experiments/`. One JSON file per experiment, named `exp-001.json`, `exp-002.json`, etc.

---

## Step 1 — Guard: check for open experiment PR

```bash
gh pr list --state open --search "[self-improve]" --json number,title
```

If the output contains any PRs, print:

> Experiment PR #N ("<title>") is open — waiting for Beau to merge before running the next experiment.

Then stop. Do not proceed.

---

## Step 1b — Transition merged PRs to awaiting-swipes

For any experiment with `status = "pr_open"`, check whether its PR has been merged:

```bash
gh pr view <pr_number> --json state,mergedAt
```

If `state = "MERGED"`:
- Set `status = "merged_awaiting_swipes"`
- Set `merge_date` to the `mergedAt` date (ISO format, date only: `2026-05-06`)
- Save the updated experiment JSON

This is what signals the fetcher to start tagging new jobs with this experiment's ID.

---

## Step 2 — Evaluate merged experiments

Read every file in `.claude/self-improvement/experiments/`. For each with `status = "merged_awaiting_swipes"`:

**Query swipe coverage:**
```bash
sqlite3 data/autoapply.db "
  SELECT
    COUNT(*) AS total_tagged,
    SUM(CASE WHEN status NOT IN ('new','fetched','prescored') THEN 1 ELSE 0 END) AS terminal
  FROM jobs
  WHERE experiment_id = '<log.id>';
"
```

If `terminal / total_tagged < 0.80`, skip — not enough swipes yet. Print:
> Experiment <id>: <terminal>/<total_tagged> jobs swiped — waiting for more coverage.

If coverage ≥ 80%, compute results:

```bash
sqlite3 data/autoapply.db "
  SELECT
    SUM(CASE WHEN status IN ('needs_tailoring','tailoring','tailored','ready_to_apply','applied','interview_invite') THEN 1 ELSE 0 END) AS approved,
    SUM(CASE WHEN status = 'rejected' AND rejected_by = 'user' THEN 1 ELSE 0 END) AS rejected,
    SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
    COUNT(*) AS jobs_tagged
  FROM jobs
  WHERE experiment_id = '<log.id>';
"
```

**Baseline** (non-experiment jobs in the same date window):
```bash
sqlite3 data/autoapply.db "
  SELECT
    SUM(CASE WHEN status IN ('needs_tailoring','tailoring','tailored','ready_to_apply','applied','interview_invite') THEN 1 ELSE 0 END) AS approved,
    SUM(CASE WHEN status = 'rejected' AND rejected_by = 'user' THEN 1 ELSE 0 END) AS rejected
  FROM jobs
  WHERE experiment_id IS NULL
    AND discovered_at >= '<log.merge_date>'
    AND discovered_at < date('<log.merge_date>', '+14 days');
"
```

Compute `approval_rate = approved / (approved + rejected)` for both. Write back to the experiment JSON:

```json
{
  "swipe_results": {
    "jobs_tagged": ...,
    "jobs_swiped": ...,
    "approved": ...,
    "rejected": ...,
    "skipped": ...,
    "approval_rate": ...,
    "baseline_approval_rate": ...,
    "verdict": "<your prose: did it improve quality? volume? both? neither?>"
  },
  "status": "evaluated"
}
```

Save the updated JSON back to `.claude/self-improvement/experiments/<id>.json`.

---

## Step 3 — Load history and analyze pipeline health

**Read all experiment logs** to understand what has already been tried (including failed proxy tests). Never repeat a `proxy_failed` experiment. Never repeat a shipped change that produced a good `evaluated` result unless there's new data suggesting it drifted.

**Run pipeline health queries:**

```bash
sqlite3 data/autoapply.db "
  -- Pass-through rate by source (last 14 days)
  SELECT source,
    COUNT(*) AS total,
    SUM(CASE WHEN status NOT IN ('rejected','fetched','prescored') THEN 1 ELSE 0 END) AS surfaced,
    ROUND(100.0 * SUM(CASE WHEN status NOT IN ('rejected','fetched','prescored') THEN 1 ELSE 0 END) / COUNT(*), 1) AS pct
  FROM jobs
  WHERE discovered_at >= date('now', '-14 days')
  GROUP BY source ORDER BY total DESC;
"
```

```bash
sqlite3 data/autoapply.db "
  -- Top rejection reasons (last 14 days)
  SELECT rejection_reason, rejected_by, COUNT(*) AS n
  FROM jobs
  WHERE status = 'rejected' AND discovered_at >= date('now', '-14 days')
  GROUP BY rejection_reason, rejected_by
  ORDER BY n DESC LIMIT 25;
"
```

```bash
sqlite3 data/autoapply.db "
  -- LLM call waste: agent rejections not due to score (wrong-function titles)
  SELECT title, COUNT(*) AS n
  FROM jobs
  WHERE rejected_by = 'agent'
    AND rejection_reason NOT LIKE 'score%'
    AND discovered_at >= date('now', '-14 days')
  GROUP BY title ORDER BY n DESC LIMIT 20;
"
```

```bash
sqlite3 data/autoapply.db "
  -- Score distribution of agent-rejected jobs (last 14 days)
  SELECT
    CASE
      WHEN score < 20 THEN '<20'
      WHEN score < 35 THEN '20-34'
      WHEN score < 50 THEN '35-49'
      WHEN score < 65 THEN '50-64'
      ELSE '65+'
    END AS bucket,
    COUNT(*) AS n
  FROM jobs
  WHERE rejected_by = 'agent' AND score IS NOT NULL
    AND discovered_at >= date('now', '-14 days')
  GROUP BY bucket ORDER BY bucket;
"
```

```bash
sqlite3 data/autoapply.db "
  -- Daily discovery volume and pass-through (last 14 days)
  SELECT date(discovered_at) AS day,
    COUNT(*) AS total,
    SUM(CASE WHEN status NOT IN ('rejected','fetched','prescored') THEN 1 ELSE 0 END) AS surfaced
  FROM jobs
  WHERE discovered_at >= date('now', '-14 days')
  GROUP BY day ORDER BY day;
"
```

Synthesize: where is the biggest leak? What's the highest-volume fixable problem that hasn't been tried yet?

---

## Step 4 — Pick an experiment

Choose **one** improvement. Priority order:

1. **Filter fixes** with high-volume rejection data backing (e.g. a location pattern causing >50 rejections/day that's plausibly wrong)
2. **Title exclusion additions** — wrong-function titles reaching the LLM scorer (>20 jobs/day of one title pattern)
3. **Score threshold adjustment** — cluster of jobs near the current threshold that look like good fits from their titles
4. **Source-specific tuning** — a source with 0% pass-through for a diagnosable reason

Do NOT attempt:
- Schema changes (`schema.sql`)
- New ATS sources
- Scoring rubric rewrites (the agent prompt in `score-jobs.md` — threshold changes only)
- Any changes to `package.json`, `frontend/`, or `data/`

Document your choice:
- `problem`: what the data shows (be specific — include counts)
- `hypothesis`: what you'll change and why you expect it to help
- `change.type`: one of `filter | threshold | keywords | source`
- `change.description`: what file and what specifically changes

Assign an experiment ID by reading existing logs and incrementing: if the last is `exp-003.json`, the next is `exp-004`.

---

## Step 5 — Run the replay sniff test

```bash
# For a filter change (pass only the fields you're modifying):
npx tsx backend/self-improve/run-replay.ts \
  --mode filter \
  --criteria '{"exclusions":{"title_keywords":["new keyword"]}}' \
  --lookback-days 14

# For a threshold change:
npx tsx backend/self-improve/run-replay.ts \
  --mode threshold \
  --threshold 30 \
  --lookback-days 14
```

**Evaluate the ReplayResult:**

- **Quantity**: `would_surface` vs `baseline_surfaced`. A meaningful improvement surfaces meaningfully more jobs. A result that would surface >10× the baseline is a red flag — the change is too loose.
- **Quality**: Read the `titles` array. If more than ~30% look like wrong-function (not PM roles), verdict is `no_ship`.
- **Score distribution** (threshold experiments): most newly promoted jobs should cluster in 35–50, not at the very bottom.

Write `proxy_results`:
```json
{
  "baseline_surfaced_per_day": <baseline_surfaced / 14>,
  "experiment_surfaced": <would_surface>,
  "quality_signals": "<prose: what the titles look like, any concerns>",
  "agent_verdict": "ship" or "no_ship",
  "agent_reasoning": "<why you decided to ship or not>"
}
```

**If `no_ship`:** save the experiment JSON with `status = "proxy_failed"` to `.claude/self-improvement/experiments/<id>.json` and stop. Print a summary of what you found and why you didn't ship.

---

## Step 6 — Implement the change and open a PR

Only reach here if `agent_verdict = "ship"`.

### 6a. Create a worktree and branch

```bash
git worktree add ../spore-<exp-id> origin/main
cd ../spore-<exp-id>
git checkout -b beau/self-improve-<exp-id>
ln -s /Users/beau/Documents/dev/spore/node_modules node_modules
```

### 6b. Apply the change

Edit the relevant file:
- **Filter / keywords changes**: `backend/filters.ts` or update `criteria.exclusions.title_keywords` in the DB via `scripts/add-title-exclusions.ts` pattern
- **Threshold change**: update `threshold: N` in `.claude/agents/score-jobs.md` (the `upsert_scored` call and the "do not relax below" rule)

Keep the change minimal and exactly scoped to what the experiment tests. Do not refactor surrounding code.

### 6c. Run tests

```bash
./node_modules/.bin/vitest run backend/filters.test.ts
```

Must pass. If tests fail, fix them (adding cases for the new behavior is fine; changing existing passing assertions is not).

### 6d. Commit

```bash
git add <changed files>
git commit -m "[self-improve <exp-id>] <one-line description of the change>"
```

### 6e. Push and open PR

```bash
git push -u origin beau/self-improve-<exp-id>

gh pr create \
  --title "[self-improve <exp-id>] <short description>" \
  --label "self-improvement" \
  --body "..."
```

**PR body must include:**

```
## Experiment <exp-id>

### Problem
<from experiment log — be specific, include counts from the data>

### Hypothesis
<what you changed and why you expect it to help>

### Replay results
- Lookback window: 14 days
- Total rejected candidates: <total_candidates>
- Would surface under new logic: <would_surface>
- Baseline surfaced (same window): <baseline_surfaced>
- Sample titles surfaced by the change: <first 10 from titles array>

### Agent reasoning
<agent_reasoning from proxy_results>

### Experiment log
`.claude/self-improvement/experiments/<exp-id>.json`

---
🤖 Self-improvement agent — [SPORE-56](https://linear.app/beausideas/issue/SPORE-56)
```

### 6f. Save experiment state

Update the experiment JSON:
```json
{
  "status": "pr_open",
  "pr_url": "<url>",
  "pr_number": <number>
}
```

Save to `.claude/self-improvement/experiments/<exp-id>.json` **in the original repo**, not the worktree (the worktree will be cleaned up after the PR merges).

```bash
# Write the file from the original repo root
cat > /Users/beau/Documents/dev/spore/.claude/self-improvement/experiments/<exp-id>.json << 'EOF'
{ ... }
EOF
```

---

## Final report

Print a summary:
- Experiment ID and what was tested
- Replay result numbers
- PR URL
- Any experiments evaluated in Step 2 and their verdicts

---

## Hard constraints

- **One experiment at a time.** If Step 1 finds an open PR, stop immediately.
- **Replay is read-only.** Never write to `data/autoapply.db` during analysis.
- **`experiment_id` tagging happens at fetch time, not here.** When a PR merges, the fetcher reads `.claude/self-improvement/experiments/` for any `pr_open` experiment — that's when jobs get tagged. Do not tag jobs yourself.
- **Never touch**: `schema.sql`, `package.json`, `frontend/`, `data/`, `backend/mcp/server.ts`.
- **Tests must pass** before pushing.
- **PR title must start with `[self-improve`** so the guard in Step 1 can detect it.
