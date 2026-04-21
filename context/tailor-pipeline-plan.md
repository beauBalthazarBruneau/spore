# Tailor Pipeline — Planning Doc

> Scope: Stages 2a (Probe) and 2b (Tailor) of the Spore pipeline. Everything here is downstream of [`PRD.md`](./PRD.md) and should be read alongside it.

## Problem

Once a user has approved a job in the swipe queue, there's a chasm between "this is a job I want" and "this is an application I can submit." Crossing it by hand takes 30–90 minutes per role and is the single biggest reason job seekers stop applying. The work is:

1. Reading the job description carefully and figuring out which of your experiences matter most for this role.
2. Rewriting resume bullets to lead with the most relevant framing.
3. Writing a cover letter (often), or answering 2–10 custom questions (increasingly common), or both.
4. Looking up demographic and work-authorization boilerplate.
5. Making sure you haven't already applied and that your documents aren't stale.

Most of this is not creative work. It's pattern-matching against things the user has already written or can answer once and reuse forever. But it's also not purely mechanical — the "which experiences matter most" step requires judgment that generic templates can't provide.

**The pipeline's job is to generate everything required to actually submit the application.**

A second, quieter problem: generating artifacts the employer doesn't want is wasteful. A lot of postings don't accept cover letters; some ask five custom questions; some ask none. Blindly producing a resume + cover letter + answer pack burns tokens on artifacts that get thrown away and gives the user more noise to review. The pipeline should match its output to what the form actually requires.

## Success criteria

- **Throughput**: a user who approves 10 jobs in a swipe session has 10 ready-to-review application packages the next morning, with no manual intervention in the common case.
- **Fidelity**: tailored resumes use the same visual template as the master; no format drift, no fabricated experience, no hallucinated employers.
- **Minimum-viable output**: a job that only wants a resume gets a resume. A job with 5 custom questions gets 5 answers. No wasted artifacts.
- **Reuse**: the second time the user sees "why are you interested in working here" on a form, the answer is already written (by them, not from scratch).
- **Review speed**: reviewing a tailored package takes under 2 minutes in the common case. The user should rarely need to edit; when they do, edits should feed back into the system.

## Non-goals

- Interview-style long-form writing (e.g., a take-home assignment).
- Generating artifacts for gated-board postings (LinkedIn Easy Apply, etc.) — those stay out of scope.

---

## Architecture at a glance

The pipeline splits into **two distinct phases that share no LLM state**:

```
approved → [Probe] → needs_tailoring → [Tailor] → tailored → ready_to_apply
               │                           │
               ↓                           ↓
         probe_failed              (stays in tailoring on render failure)
```

The split matters because the two phases have fundamentally different properties:

| | **Probe** | **Tailor** |
|---|---|---|
| Nature of work | Deterministic inspection of an external form | Judgment-based content generation |
| LLM involvement | None in the common case (fallback only for unknown ATSes) | Core — this is the creative step |
| Failure mode | External: form unreachable, auth required, unknown structure | Internal: bad generation, render failure, validator rejection |
| Cost to re-run | Trivial (cheap HTTP calls) | Expensive (tokens per run) |
| Parallelism | High — probe a whole queue in minutes | Medium — bounded by token budget |

Putting them in the same stage would mean every tailor failure requires re-probing, every probe failure burns tokens on a doomed tailor run, and the whole thing becomes hard to reason about.

---

## Data ownership

**All pipeline artifacts live in the SQLite DB. Nothing the user (or any downstream stage) cares about is ever written to disk.**

This is not a stylistic preference; it's a hard architectural rule. The DB is the system of record for:

- The master resume (in `profile.base_resume_json`).
- Every tailored resume, cover letter, application answer, and rendered PDF (on the `jobs` row that owns them).
- The probe record for every application.
- The reusable question-answer bank.
- Every log/event emitted by the pipeline.

This has three downstream consequences that matter:

1. **Agents interact with artifacts only through the MCP server.** No `fs.readFile`, no local paths, no `scripts/output/` directories. If an agent needs something, there's an MCP tool for it.
2. **Renderers write PDFs directly to the DB.** The render step is part of the write path, not a post-process. After a successful render, `jobs.resume_pdf` (a BLOB column) contains the final bytes. No intermediate `data/output/job_123.pdf` file exists.
3. **Transient tool-side temp files are allowed in `/tmp`**, because some renderers (notably `pdflatex`) can't run without a scratch directory. Those must be cleaned up per-invocation and never escape the process. The rule is about *persistent artifacts*, not about what a subprocess needs while executing.

The single exception: `data/spore.db` itself lives on disk (it's a file). That's the boundary.

---

## Phase 1: Probe

**Goal**: For every approved job, build a structured description of what the employer's application form actually requires, so Tailor knows what to produce and Submit knows what to submit.

### Inputs and outputs

**Reads (via MCP):**
- `jobs.url` — the application URL.
- `jobs.source` — ATS hint, if the Find Jobs stage already identified one.
- External, non-DB: HTTP fetches to known ATS endpoints; headless browser for the generic path.

**Writes (via MCP):**
- `jobs.application_form_json` — the structured probe record (see below).
- `jobs.status` — `needs_tailoring` on success, `probe_failed` with a reason on failure.
- `events` — one `probe_applications_run` event per orchestrator invocation, with counts and duration.

Nothing from this phase is written to disk. The headless browser runs in memory; any captured artifacts (HARs, screenshots) are either written to the DB as debugging attachments or discarded.

### What Probe produces

A single structured record per job describing:

- **Submission method** — can this be submitted via ATS API, or does it need browser automation, or is it gated entirely?
- **Resume expectations** — required/optional, accepted formats, upload-only vs. paste-in.
- **Cover letter** — accepted at all? Required? Any length constraints?
- **Custom questions** — for each one: label, required/optional, type (freeform / enum / number), length constraints, option list if applicable.
- **Demographic section** — present and required? (Auto-filled later from user profile, not generated.)

This record is the contract between Probe, Tailor, and Submit. Tailor reads it to decide what to generate. Submit reads it to know where each field goes.

### Sub-phases within Probe

The Probe phase itself has a tiered strategy, strongest signal first:

**1.1 Known-ATS probe.** Most postings in the watched set come from a small handful of ATSes (Greenhouse, Lever, Ashby, Rippling). Each exposes its application form structure through a public endpoint. When we can identify the ATS, this is the fastest, most reliable path and doesn't involve a browser or an LLM.

**1.2 Generic-browser probe.** For postings outside the known set, the fallback is a headless browser walk. The browser navigates the application URL, enumerates form controls, and captures label text. The structural pass is deterministic; classifying unknown labels ("is this asking for a cover letter?") is the one place an LLM shows up in this phase, as a small one-shot per unknown field.

**1.3 Failure handling.** Some postings will resist both paths: auth walls, redirect loops, CAPTCHAs at the form-load step, JavaScript that won't settle. These don't fall through to Tailor with a null form description — doing so would waste Tailor tokens on a job that can't be submitted anyway. Instead the job enters a terminal state (`probe_failed`) with a reason, and surfaces in the UI for manual unblock or rejection.

### Why this phase is deterministic-first

Probe is fundamentally a data-extraction problem, not a judgment problem. Classifying "is this label asking for a cover letter" is the narrowest possible LLM use — one call, one field, structured output. Doing the whole phase as an LLM run would be a tokens-for-reliability trade we shouldn't want.

---

## Phase 2: Tailor

**Goal**: Given an approved job, the user's master materials, and the probe record, produce the exact artifacts the form requires — nothing more, nothing less — and surface them for review.

### Inputs and outputs

**Reads (via MCP):**
- `jobs.description`, `jobs.title`, `jobs.application_form_json`, `companies.name`.
- `profile.base_resume_json` — the master resume (sacred, read-only for the agent).
- `profile.criteria_json`, `profile.preferences_json` — to inform framing without dictating content.
- `profile.demographics_json` — read but never surfaced to the LLM; consumed by Submit.
- `question_answers` — approved, reusable entries consulted before any fresh generation.

**Writes (via MCP):**
- `jobs.resume_json` — the tailored resume data. Always written.
- `jobs.resume_tex`, `jobs.resume_pdf` — produced by the render step (see 2.4) and written to the DB directly as part of the same MCP call that advances status.
- `jobs.cover_letter_md`, `jobs.cover_letter_pdf` — only if `application_form_json` shows a cover letter slot.
- `jobs.application_answers_json` — only if the form has custom questions; keyed by question id.
- `question_answers` — new rows when the agent generates an answer it marks reusable; bumps `use_count` and `last_used_*` on hits against existing rows.
- `jobs.status` — `tailored` on full success; stays `tailoring` (with an error note) on render or validation failure.
- `events` — one `tailor_run` event per agent invocation.

Nothing from this phase is written to disk. `pdflatex` uses a per-invocation temp directory in `/tmp` that is cleaned up before the render step returns — the PDF bytes are piped straight into `jobs.resume_pdf` and the temp dir is gone. No `data/output/` directory, no sidecar tex file, no cached renders outside the row.

### What Tailor produces

Conditional on the probe record. For each job:

- **Always**: a tailored resume (the core artifact, and the one that takes the most judgment).
- **If the form accepts a cover letter**: a cover letter.
- **If the form has custom questions**: answers keyed by question, drawing from the user's existing answer bank where possible, generating fresh where not.
- **Never from Tailor**: demographic information (comes from the user's profile, filled in at submit time).

### Sub-phases within Tailor

**2.1 Resume tailoring.** The creative core. The agent reads the job description and the user's master resume (structured, not prose) and produces a tailored version that reorders, trims, and rewrites bullets for relevance. It **cannot** add companies, roles, or education — that's a factual hallucination we explicitly prevent via validation. The tailored resume is data; visual formatting is applied by a deterministic render step after generation.

**2.2 Cover letter.** Skipped entirely when the form doesn't accept one. When it does, generated freeform in markdown. No template macros — cover letters are already conventional enough that markdown-to-pdf is sufficient.

**2.3 Custom-question answering with a reusable bank.** The first time a user is asked "why this company," the agent generates an answer. The user reviews and edits. The approved answer goes into a bank of reusable answers keyed by a normalized fingerprint of the question. The next time the same question appears on a different form, the bank hit replaces generation entirely. "Why this company" is company-specific and not reusable, but "work authorization," "years of React experience," "salary expectations," and "how did you hear about us" are — and they are the long tail.

**2.4 Render.** The tailored resume data is pure JSON until a deterministic render step emits the final PDF. This separation means the generation step doesn't have to understand LaTeX, and the render step can be tested independently. A render failure leaves the job in an intermediate state with a clear error — it doesn't promote a half-baked artifact. The render step should also automatically put the resumepdf into the db.

**2.5 Review gate.** Every tailored package advances to a state where the user can inspect and approve. Edits to any artifact can propagate back: edits to answer bank entries update the bank; edits to the resume update only this application's tailored copy (the master is sacred).

### Why this phase is LLM-first

Tailor is where judgment lives. Picking which bullets matter, how to frame prior experience against a specific JD, how to rewrite without fabricating — this is what the LLM is good at and what users can't scale on their own. The architectural goal is to give the LLM the narrowest possible task (generate JSON conforming to a schema, against a known master, with a known form description) and leave everything else to deterministic code.

---

## Architectural principles specific to this project

1. **The probe record is the contract.** Everything downstream keys off it. If it's wrong, everything is wrong — so the probe phase must be conservative (refuse rather than guess).
2. **Master materials are sacred.** The user's master resume, demographic info, and approved answer bank are never modified by the agent. Tailored copies live on individual job rows.
3. **Validation prevents fabrication.** Tailored resumes that introduce new companies, roles, or education are rejected before render. This is a hard constraint, not an LLM instruction.
4. **Deterministic code renders, not the LLM.** The LLM produces structured data. Templates, macros, and formatting are code. This prevents format drift and makes the output auditable.
5. **The answer bank is a first-class artifact.** It's not a cache — it's the user's growing library of themselves. It outlives any individual application. Edits to bank entries can propagate to already-filled applications when the question fingerprints match closely enough (see Open Questions on fingerprinting).
6. **DB is the system of record.** See [Data ownership](#data-ownership). No pipeline artifact is ever written to disk outside the DB file itself.

---

## Dependencies and risks

- **pdflatex** becomes a system-level dependency. Missing or misconfigured latex breaks the render step. Needs to fail clearly and early, and be documented. Worth genuinely reconsidering before we build — see Open Questions ("Do we have to use LaTeX?").
- **ATS endpoint stability** — the public endpoints we rely on for Probe are stable in practice but uncontractual. When they break, probes silently degrade to generic-browser. Monitoring should surface a shift in the Known-ATS vs. Generic-browser split.
- **LLM drift in the answer bank** — if the agent generates subtly different answers to similar questions, the bank fragments and loses its value. The fingerprint normalization needs to be neither too loose (wrong answers matched) nor too strict (no matches).
- **Browser automation flakiness** — generic-browser probe will be the noisiest component. Needs retries, timeouts, and a clean "give up" path to `probe_failed`.

---

## Open questions

- **Do we have to use LaTeX?** The user's master is in LaTeX and the template is good, but `pdflatex` is a heavy system dependency and an awkward failure mode. Real alternatives worth weighing:
  - **Typst** — modern, fast, much nicer syntax, but the ecosystem is young and we'd be re-authoring the template.
  - **HTML/CSS → PDF via Playwright** — we're already pulling in Playwright for Probe, so zero additional install cost. Modern styling, web-tool ergonomics, but we'd re-author the template in HTML/CSS and accept slightly less precise typographic control.
  - **Pandoc** — a markdown-first pipeline; it still uses LaTeX under the hood for PDF so it doesn't escape the dependency.
  - **React-PDF / programmatic libs** — deterministic but ugly templates.
  - Best candidate to consider seriously: Playwright-based HTML/CSS → PDF, on the strength of already-installed infra. Decision needed before building the render step.
- **How aggressive should question fingerprinting be?** Exact-match is useless; stemming + normalization is standard; semantic match (embed the question, nearest-neighbor the bank) is powerful but heavier. **Decided:** start with stemming, revisit once we see real overlap rates.
- **Do edits to answer-bank entries propagate to previously-filled applications?** **Decided:** yes, when the fingerprints match closely enough. Implementation needs to define "closely enough" (exact fingerprint hit vs. threshold on a similarity score), and needs to visibly flag the propagated change so the user isn't surprised.
- **Is there a Tailor-level review checkpoint before generation?** E.g., does the agent show its proposed "changes plan" before producing artifacts? Probably not in v1 — the review gate on output is the single user-facing checkpoint. But if generations are frequently wrong, we may want it.
- **How do we handle postings that want multiple resumes** (general + specific)? Edge case, punt to v1.5.

---

## What gets built, sketched

Implementation will be broken into ticket-sized units of work once this doc settles. The shape will roughly be:

- Schema extensions to support the probe record, question bank, and new resume-as-data format.
- Probe phase: dispatcher + per-ATS implementations + generic-browser fallback + orchestrator stage.
- Render phase: JSON → tex → pdf, plus the one-off migration from the existing master tex to JSON.
- Tailor phase: agent spec + MCP tools + question-bank interaction.
- Frontend: review surface for tailored packages, editor for profile additions.

A separate ticket-breakdown doc will slot in under this one when we're ready to create Linear issues.
