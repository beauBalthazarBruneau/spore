---
name: mygreenhouse-login
description: Refresh the MyGreenhouse candidate-portal session that backend/fetchers/mygreenhouse.ts depends on. Use when the fetcher reports auth_expired, when the session file is missing, or when the user explicitly asks to re-login to MyGreenhouse.
---

# MyGreenhouse Login agent

Spore pulls cross-company Greenhouse jobs from `my.greenhouse.io` via an authenticated Inertia.js API. The session cookie is httpOnly, so it can't be lifted from a regular browser MCP — Playwright drives the login dance and saves cookies to `data/mygreenhouse-session.json`. Your job is to drive that script: pipe in the security code from Gmail when it asks for one.

You only have three things to do, in order. Run the script once, feed it a code, confirm success.

## Tools you'll use

- **Bash** — to launch `scripts/mygreenhouse-auth.ts` in the background and to write the code file
- **Read** — to check for `data/mygreenhouse-code-needed` (the script's "I'm ready for the code" signal)
- **mcp__claude_ai_Gmail__search_threads** — find the most recent security-code email
- **mcp__claude_ai_Gmail__get_thread** — read the body to pull the 8-char code
- **Write** — drop the code into `data/mygreenhouse-code.txt`

## Steps

### 1. Sanity check the existing session
Before doing anything, check whether a session even needs refreshing:

```bash
test -f data/mygreenhouse-session.json && cat data/mygreenhouse-session.json | jq '.saved_at'
```

If a session file exists and the user didn't explicitly ask for a re-login, report the saved-at timestamp and confirm with the user that they want to refresh before proceeding.

### 2. Launch the Playwright script in the background

```bash
mkdir -p data
# Clear any stale signal/code files from a previous failed run
rm -f data/mygreenhouse-code.txt data/mygreenhouse-code-needed
npx tsx scripts/mygreenhouse-auth.ts
```

Run this with `run_in_background: true`. The script will:
1. Launch headless Chromium
2. Submit the user's email (read from `profile.email`)
3. Wait for the security code email to arrive
4. Drop `data/mygreenhouse-code-needed` to signal "ready for the code"
5. Poll `data/mygreenhouse-code.txt` every 2s
6. Submit the code, save cookies + Inertia version, exit

### 3. Wait for the "code needed" signal

The script signals readiness by creating `data/mygreenhouse-code-needed`. Poll for it:

```bash
until test -f data/mygreenhouse-code-needed; do sleep 2; done
```

Use the Monitor tool (or another short bash check) — don't hammer the filesystem with a tight loop. Once the file exists, the email has been submitted and Greenhouse has dispatched a security code to the user's inbox.

### 4. Pull the code from Gmail

The security email comes from `login@us.greenhouse-jobs.com` with subject containing "MyGreenhouse security code". Body looks like:

> Your security code is: bmxmwbj6

Pull the most recent thread:

```
mcp__claude_ai_Gmail__search_threads({ query: "from:login@us.greenhouse-jobs.com subject:security newer_than:10m", pageSize: 3 })
```

Grab the snippet — the code is usually right after "Your security code is:" — and confirm it's an 8-character alphanumeric string. If the snippet is truncated, call `get_thread` for the full body.

If multiple threads are returned, pick the newest by `date`. Codes expire in 10 minutes, so anything older isn't useful.

### 5. Drop the code into the polling file

```
Write data/mygreenhouse-code.txt with content: <code>
```

The script picks this up within 2 seconds and proceeds. It will print `[mygreenhouse-auth] got code (8 chars), submitting` and then save the session file.

### 6. Confirm success

Wait for the background bash job to complete (you'll be notified). Check that the session file landed:

```bash
test -f data/mygreenhouse-session.json && jq '{saved_at, version: .inertia_version, cookies: (.cookies | length)}' data/mygreenhouse-session.json
```

Then verify the session actually works by running the fetcher in dry-test mode — call the fetcher and inspect the report. If `auth_expired: true` comes back, something went wrong (cookies didn't get saved, or expired immediately).

```bash
npx tsx backend/orchestrate.ts --name mygreenhouse
```

Report to the user: number of cookies saved, the Inertia version, and how many jobs the smoke fetch returned.

## Failure modes

- **Email never arrives:** the user may have a mail rule routing it to spam. Tell them to check spam, and offer to re-run.
- **Code expired (10-minute window):** if the Gmail search returns nothing fresh enough, kill the script, ask the user, restart.
- **Inertia version mismatch on first fetch:** the fetcher itself self-heals — it falls back to scraping the version from the HTML page. If that also fails, the session is genuinely dead.
- **Script hangs past 5 minutes:** it times out on its own and exits non-zero. Re-run from step 2.

## Style

Be terse. This is a procedural task, not an exploration. The user wants "logged in" / "didn't work, here's why" — no narrating each step.
