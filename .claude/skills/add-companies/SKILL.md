---
name: add-companies
description: Add companies to the spore tracking database. Use when the user wants to add specific companies by name, or when they want to discover and watch companies that recently raised Series A/B funding (or other discovery criteria).
---

# add-companies

Two modes — pick based on the user's request:

1. **Direct list** — user names companies ("add Anthropic, Cursor, Linear"). Enrich each with ATS info, confirm, write.
2. **Discovery** — user describes a search ("companies that raised Series A/B in the last 2 months", optionally scoped to a sector or location). Find names via WebSearch, then fall through to mode 1.

## How companies are stored

The `companies` table (see `backend/schema.sql`) keys on `name` (case-insensitive unique). The fields that matter:
- `ats_source` — `greenhouse` | `lever` | `ashby` | `rippling` | `null` (manual tracking only)
- `ats_slug` — the company's board identifier on that ATS
- `watching` — `1` means the find-jobs agent will pull jobs from this company on every run

A company is only useful to the job pipeline when `watching=1` AND it has a working `ats_source` + `ats_slug`. Bare names (no ATS) are still worth adding — the user can fill in the ATS later via the Companies UI.

All writes go through the **`spore` MCP server** (registered in `.mcp.json` at the repo root). Tools you'll use here:
- `mcp__spore__upsert_company` — create or update; probes the ATS slug before flipping `watching=1`
- `mcp__spore__probe_ats` — read-only ATS probe (no writes); useful when verifying a slug you found
Do not write SQL directly — the MCP server is the single channel for DB writes.

## Finding the ATS slug

Slugs are quirky — `joinroot` for Root Insurance, `getzep` for Zep, etc. Don't assume the slug is the company name lowercased; ask the company's own careers page instead.

For each company, work in this order:

1. **Find the careers page.** WebSearch `"<Company> careers"` (or `"<Company> jobs"` if the first search is too noisy with funding news). Pick the result on the company's own domain — usually `<company>.com/careers`, `/jobs`, or `/company/careers`.

2. **WebFetch the careers page** and look for ATS fingerprints in the response. The slug is the path segment immediately after the host:
   - **Greenhouse**: `boards.greenhouse.io/<slug>`, `boards-api.greenhouse.io/v1/boards/<slug>/...`, or `job-boards.greenhouse.io/<slug>`. Also embedded as `<iframe src="https://boards.greenhouse.io/embed/job_board?for=<slug>">`.
   - **Lever**: `jobs.lever.co/<slug>` or `api.lever.co/v0/postings/<slug>`.
   - **Ashby**: `jobs.ashbyhq.com/<slug>` or `api.ashbyhq.com/posting-api/job-board/<slug>`.
   - **Rippling**: `ats.rippling.com/<slug>` or `ats.rippling.com/api/v2/board/<slug>/jobs`.

   If the careers page is a SPA that doesn't reveal the ATS in initial HTML, look for "Apply" links on individual job postings — those almost always link directly to the ATS-hosted application URL, which contains the slug.

3. **If the careers page hard-redirects** (e.g. `/careers` → `jobs.lever.co/foo`), the redirect target gives you everything: ATS source from the host, slug from the path. WebFetch will report the redirect.

4. **Fallback — blind probe.** If steps 1–3 don't yield an ATS, try the four board URLs directly with `<companyname>` lowercased (no spaces, no `inc`/`corp`/`labs` suffix):
   - `https://boards.greenhouse.io/<slug>`
   - `https://jobs.lever.co/<slug>`
   - `https://jobs.ashbyhq.com/<slug>`
   - `https://ats.rippling.com/<slug>/jobs`

   A real board returns job listings; a 404 or redirect to a marketing page means it's wrong. Only useful when the company's own site doesn't surface the ATS.

5. **If still no ATS found**, add the company with `ats_source: null`, `ats_slug: null`, `watching: false`. Tell the user it was added without ATS so they know it won't auto-fetch jobs and can fill in the ATS later via the Companies UI.

`upsert_company` independently probes the slug before flipping `watching=1`, so a wrong slug won't silently waste fetch cycles — but the careers-page approach gets it right up front and avoids the false-positive risk of blind probing (where a different company happens to own the slug you guessed). Use `probe_ats` when you want to test a candidate slug before committing to it.

## Discovery mode (Series A/B and similar)

When the user asks to find recently-funded companies:

1. Run a couple of WebSearch queries — vary the phrasing because funding-news SEO is noisy. Examples:
   - `"raised Series A" OR "raised Series B" 2026 [sector if specified]`
   - `"announced Series A" site:techcrunch.com` (or `site:axios.com`, `site:businessinsider.com`)
   - `Series A funding [month] [year] [sector]`
2. For each promising hit, WebFetch the article and pull out the company name, round, amount, date, and (if mentioned) what they do.
3. Filter by the user's window (e.g. "last 2 months" → compute the cutoff date from today and drop anything older). Today's date is in your context as `currentDate`.
4. Present the candidates to the user as a short list with one-line descriptions and ask which to add. Don't add silently.

## Confirming before writing

Always show the user the final enriched list before writing. Format:

```
About to add (watching=1 unless noted):
  - Acme (greenhouse:acme) — fintech, Series A $20M, Mar 2026
  - Beta Co (lever:beta) — devtools, Series B $50M, Feb 2026
  - Gamma Inc — no ATS found, will add with watching=0
Proceed?
```

Get a yes before writing.

## Writing the companies

Call `mcp__spore__upsert_company` once per company. The tool returns `{ action, company, warning? }`. If `warning` is present, the slug failed the probe and `watching` was forced to 0 — surface that to the user.

For discovery additions, **always** put the funding context in `notes` (round, amount, month) — that's the whole reason the company is being tracked, and it'll show up later in the Companies UI.

```
mcp__spore__upsert_company({
  name: "Acme",
  ats_source: "greenhouse",
  ats_slug: "acme",
  watching: true,
  notes: "Series A $20M, Mar 2026 — fintech infra"
})
```

Flags worth knowing:
- `skip_probe: true` — bypass the ATS reachability probe (use only if you've already verified the slug yourself, e.g. via `probe_ats`).

## After adding

Tell the user:
- Watched companies get pulled on the next find-jobs run.
- They can edit ATS info or toggle `watching` from the Companies page in the frontend.
- Any company that came back with a `warning` needs its slug fixed before it'll fetch.
