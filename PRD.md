# AutoApply — PRD

## Summary
AutoApply is an open-source, Claude Code–driven automated job application submitter. It finds relevant roles, tailors a resume to each one, submits applications, and kicks off networking outreach — all orchestrated by Claude Code agents behind a simple frontend anyone can run locally.

## Goals
- Let a job seeker go from "here's my background" to submitted applications with minimal manual effort.
- Be fully open source and self-hostable; users bring their own Claude API key.
- Keep the user in the loop with a clean frontend for review, approval, and monitoring.
- Demonstrate Claude Code as the automation engine — no bespoke scraping stack, no hand-rolled LLM plumbing.

## Non-Goals
- Bypassing employer ATS terms of service or CAPTCHAs.
- Hosting a multi-tenant SaaS (v1 is local/self-hosted).
- Generating fabricated experience or credentials.

## Users
Job seekers who want leverage, and tinkerers who want to fork the workflow for their own automation needs.

## Core Flow
Four stages, each a Claude Code agent task:
1. **Find Jobs** — discover postings matching the user's criteria.
2. **Tailor Resume** — produce a role-specific resume + cover letter.
3. **Submit Application** — fill and submit the employer's form.
4. **Network** — identify contacts and draft outreach.

See `flow.md` for the detailed mermaid diagram.

## Frontend
A lightweight web UI to: configure search criteria, upload base resume, review tailored outputs before submission, track application status, and view networking drafts. Communicates with the Claude Code backend over a local API.

## Success Metrics
- Time from criteria-set to first submitted application < 10 minutes.
- ≥ 80% of tailored resumes accepted by user without edits.
- Easy one-command local setup.

## Open Questions
- Which job boards to support first (LinkedIn, Greenhouse, Lever)?
- How to handle login/session state for gated boards?
- Storage: local SQLite vs. pluggable backend?
