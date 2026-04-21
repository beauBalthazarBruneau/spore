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

## Phase 1: Probe

**Goal**: For every approved job, build a structured description of what the employer's application form actually requires, so Tailor knows what to produce and Submit knows what to submit.

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

**2.4 Render.** The tailored resume data is pure JSON until a deterministic render step emits the final PDF. This separation means the generation step doesn't have to understand LaTeX, and the render step can be tested independently. A render failure leaves the job in an intermediate state with a clear error — it doesn't promote a half-baked artifact.

**2.5 Review gate.** Every tailored package advances to a state where the user can inspect and approve. Edits to any artifact can propagate back: edits to answer bank entries update the bank; edits to the resume update only this application's tailored copy (the master is sacred).

### Why this phase is LLM-first

Tailor is where judgment lives. Picking which bullets matter, how to frame prior experience against a specific JD, how to rewrite without fabricating — this is what the LLM is good at and what users can't scale on their own. The architectural goal is to give the LLM the narrowest possible task (generate JSON conforming to a schema, against a known master, with a known form description) and leave everything else to deterministic code.

---

## Architectural principles specific to this project

1. **The probe record is the contract.** Everything downstream keys off it. If it's wrong, everything is wrong — so the probe phase must be conservative (refuse rather than guess).
2. **Master materials are sacred.** The user's master resume, demographic info, and approved answer bank are never modified by the agent. Tailored copies live on individual job rows.
3. **Validation prevents fabrication.** Tailored resumes that introduce new companies, roles, or education are rejected before render. This is a hard constraint, not an LLM instruction.
4. **Deterministic code renders, not the LLM.** The LLM produces structured data. Templates, macros, and formatting are code. This prevents format drift and makes the output auditable.
5. **The answer bank is a first-class artifact.** It's not a cache — it's the user's growing library of themselves. It outlives any individual application.
6. **Every artifact is DB-resident.** No files on disk, no sidecar folders, no generated assets outside the job row. Agents interact with artifacts only through the MCP interface.

---

## Dependencies and risks

- **pdflatex** becomes a system-level dependency. Missing or misconfigured latex breaks the render step. Needs to fail clearly and early, and be documented. (Do we definitely want to go with latex? are there other ones that are better???)
- **ATS endpoint stability** — the public endpoints we rely on for Probe are stable in practice but uncontractual. When they break, probes silently degrade to generic-browser. Monitoring should surface a shift in the Known-ATS vs. Generic-browser split.
- **LLM drift in the answer bank** — if the agent generates subtly different answers to similar questions, the bank fragments and loses its value. The fingerprint normalization needs to be neither too loose (wrong answers matched) nor too strict (no matches).
- **Browser automation flakiness** — generic-browser probe will be the noisiest component. Needs retries, timeouts, and a clean "give up" path to `probe_failed`.

---

## Open questions

- **How aggressive should question fingerprinting be?** Exact-match is useless; stemming + normalization is standard; semantic match (embed the question, nearest-neighbor the bank) is powerful but heavier. Start with stemming, revisit once we see real overlap rates. I agree.
- **Do edits to answer-bank entries propagate to previously-filled applications?** Yes, If the questions are similar enough
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
