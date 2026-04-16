---
name: add-jobs
description: Add one or more job postings to the spore database from URLs, screenshots, or pasted role descriptions. Use when the user shares a link/image/text dump of a role they want tracked, regardless of whether the company is already in the database.
---

# add-jobs

Three input modes — pick based on what the user shares:

1. **URL** (most common) — they paste a link to a job posting.
2. **Screenshot** — they upload an image of a job posting.
3. **Text dump** — they paste the role description directly.

The user may share one or many in a single message. Extract them all, then write in a single batched `add_jobs` call.

## Required and useful fields

For each posting, you're filling out this shape (only `title`, `company_name`, and `url` are strictly required by the tool):

| Field | Notes |
|---|---|
| `title` | Job title — required |
| `company_name` | Required — case-insensitive match against existing companies, or auto-creates a new bare row |
| `url` | Required — the dedup key when `source_job_id` isn't set |
| `source` | `greenhouse` / `lever` / `ashby` / `rippling` if from a known ATS host, else `manual` |
| `source_job_id` | The job's unique ID on the ATS (extract from URL — see below). Falls back to `url` |
| `description` | Full role description — what the agent will use to score later |
| `location` | City/region/"Remote" |
| `remote` | `remote` / `hybrid` / `onsite` if explicit |
| `salary_min` / `salary_max` | Numeric, in USD if not specified |
| `salary_range` | Display string like `"$180k-$220k"` if you have it as text |
| `posted_at` | ISO date if visible |

## Input handling

### URL mode

WebFetch the posting URL and extract fields from the rendered content. Then look at the host to decide `source` + `source_job_id`:

| Host pattern | source | source_job_id (from URL) |
|---|---|---|
| `boards.greenhouse.io/<slug>/jobs/<id>` | `greenhouse` | `<id>` |
| `job-boards.greenhouse.io/<slug>/jobs/<id>` | `greenhouse` | `<id>` |
| `jobs.lever.co/<slug>/<uuid>` | `lever` | `<uuid>` |
| `jobs.ashbyhq.com/<slug>/<uuid>` | `ashby` | `<uuid>` |
| `ats.rippling.com/<slug>/jobs/<uuid>` | `rippling` | `<uuid>` |
| anything else | `manual` | omit (tool defaults to URL) |

Why this matters: if the company is later marked `watching=1`, future `fetch_candidates` runs will dedup against the same `(source, source_job_id)` and won't re-insert the job.

### Screenshot mode

Read the image. Extract title, company, location, description, salary. The URL is the only required field that may not be visible — if you can't read it from the screenshot, **ask the user for it**. Without a URL, dedup breaks (every paste re-inserts).

If they truly don't have one (e.g. internal posting), construct a synthetic identifier like `manual://<company-name-slug>/<title-slug>` so dedup at least catches re-pastes of the same role.

### Text dump mode

Parse the same fields from the text. Same rule for the URL — ask if it's missing.

## Status default

Default `status: "new"` — job lands in the Swipe queue for triage. Bump to `"approved"` (which auto-promotes to `"needs_tailoring"` on the Board) if the user's phrasing implies they've already decided to pursue: "I want to apply to these", "tailor these for me", "ready to submit". When in doubt, ask.

## Confirm threshold

- **1 job** → extract, write immediately, report what was added.
- **≥2 jobs** → extract all, show the parsed list, get a yes, then write in one batch.

Confirmation format:

```
About to add (status=new):
  - Acme — Senior Backend Engineer (greenhouse:4012345) [new company]
  - Beta Co — Product Designer (lever:abc-123) [Beta Co already tracked, watching=1]
  - Gamma Inc — Staff PM (manual) [new company, no ATS detected]
Proceed?
```

The `[new company]` / `[already tracked]` annotations come from cross-referencing `mcp__spore__get_profile` is not what you want — use the response from `add_jobs` itself, which returns `new_company: true` per item. For pre-write previews, you can probe with a quick read, but it's fine to just write and report after.

## Calling the tool

```
mcp__spore__add_jobs({
  status: "new",
  items: [
    {
      title: "Senior Backend Engineer",
      company_name: "Acme",
      url: "https://boards.greenhouse.io/acme/jobs/4012345",
      source: "greenhouse",
      source_job_id: "4012345",
      description: "...",
      location: "Remote (US)",
      salary_range: "$180k-$220k"
    }
  ]
})
```

Response:
```
{
  inserted: 1,
  skipped: 0,
  status: "new",
  results: [
    { title: "Senior Backend Engineer", company: "Acme", id: 247, inserted: true, new_company: true }
  ]
}
```

## After adding

Tell the user:
- **Counts**: inserted vs skipped (skipped means the URL or `(source, source_job_id)` already existed in `jobs`).
- **New companies**: list any items where `new_company: true`. Suggest the `add-companies` skill to enrich them with ATS info if they want the company on the watchlist.
- **Where to find them**: `status=new` → Swipe page; `status=approved` → Board (Needs Tailoring column).
