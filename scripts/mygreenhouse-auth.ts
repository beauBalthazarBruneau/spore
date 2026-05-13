/**
 * Playwright-driven MyGreenhouse login. Runs interactively-but-not-really:
 * the script asks for the email (or reads it from --email / the saved
 * profile), submits the form, then polls data/mygreenhouse-code.txt for the
 * 8-character security code dropped in by the orchestrating agent. Once the
 * code is accepted, it dumps the session cookies + current Inertia version
 * to data/mygreenhouse-session.json so backend/fetchers/mygreenhouse.ts can
 * reuse them headlessly.
 *
 * Usage:
 *   npx tsx scripts/mygreenhouse-auth.ts                 # reads email from profile
 *   npx tsx scripts/mygreenhouse-auth.ts --email <addr>  # explicit
 *   npx tsx scripts/mygreenhouse-auth.ts --headed        # show the browser
 *
 * The companion agent .claude/agents/mygreenhouse-login.md spawns this in
 * the background, then watches Gmail for the code email and writes it to
 * data/mygreenhouse-code.txt.
 */

import { chromium } from "playwright";
import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { getDb } from "../backend/db";

const DATA_DIR = resolve(__dirname, "../data");
const CODE_FILE = resolve(DATA_DIR, "mygreenhouse-code.txt");
const SESSION_FILE = resolve(DATA_DIR, "mygreenhouse-session.json");
const READY_FILE = resolve(DATA_DIR, "mygreenhouse-code-needed");

const CODE_POLL_INTERVAL_MS = 2000;
const CODE_TIMEOUT_MS = 5 * 60 * 1000;

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function profileEmail(): string | null {
  try {
    const row = getDb()
      .prepare(`SELECT email FROM profile WHERE id = 1`)
      .get() as { email?: string } | undefined;
    return row?.email ?? null;
  } catch {
    return null;
  }
}

async function waitForCode(timeoutMs: number): Promise<string> {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(READY_FILE, new Date().toISOString());
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(CODE_FILE)) {
      const code = readFileSync(CODE_FILE, "utf8").trim();
      if (/^[a-z0-9]{6,12}$/i.test(code)) {
        unlinkSync(CODE_FILE);
        if (existsSync(READY_FILE)) unlinkSync(READY_FILE);
        return code;
      }
    }
    await new Promise((r) => setTimeout(r, CODE_POLL_INTERVAL_MS));
  }
  if (existsSync(READY_FILE)) unlinkSync(READY_FILE);
  throw new Error(`timed out waiting for ${CODE_FILE} after ${timeoutMs / 1000}s`);
}

async function main() {
  const args = parseArgs(process.argv);
  const email = (args.email as string) || profileEmail();
  if (!email) {
    console.error("error: no email — pass --email or set profile.email");
    process.exit(2);
  }
  const headed = Boolean(args.headed);

  mkdirSync(dirname(SESSION_FILE), { recursive: true });

  console.log(`[mygreenhouse-auth] launching browser (headed=${headed}) for ${email}`);
  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto("https://my.greenhouse.io/users/sign_in", { waitUntil: "networkidle" });

    await page.fill('input[type="email"]', email);
    await page.click('button[type="submit"]');

    // The 8-box code input appears after a soft transition.
    await page.waitForSelector('input[name*="code"], input[autocomplete="one-time-code"], form input[type="text"]', {
      timeout: 15_000,
    });

    console.log(`[mygreenhouse-auth] email submitted; waiting for code at ${CODE_FILE}`);
    const code = await waitForCode(CODE_TIMEOUT_MS);
    console.log(`[mygreenhouse-auth] got code (${code.length} chars), submitting`);

    // Fill the code into whichever form variant is showing. Try OTP autocomplete first.
    const otp = await page.$('input[autocomplete="one-time-code"]');
    if (otp) {
      await otp.fill(code);
    } else {
      // 8 separate boxes — type each character. Playwright's keyboard.type respects focus moves.
      const boxes = await page.$$('form input[type="text"]');
      if (boxes.length >= code.length) {
        for (let i = 0; i < code.length; i++) await boxes[i].fill(code[i]);
      } else {
        // Fallback: type into the focused input
        await page.keyboard.type(code);
      }
    }
    await page.click('button[type="submit"]');

    // Wait for landing.
    await page.waitForURL((url) => !url.pathname.includes("sign_in"), { timeout: 20_000 });
    console.log(`[mygreenhouse-auth] logged in: ${page.url()}`);

    // Get the current Inertia version off the app shell.
    await page.goto("https://my.greenhouse.io/jobs", { waitUntil: "domcontentloaded" });
    const version = await page.evaluate(() => {
      const dp = document.getElementById("app")?.getAttribute("data-page");
      if (!dp) return null;
      try {
        return (JSON.parse(dp) as { version?: string }).version ?? null;
      } catch {
        return null;
      }
    });
    if (!version) throw new Error("could not read Inertia version after login");

    const cookies = await context.cookies("https://my.greenhouse.io");
    const session = {
      cookies: cookies.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path })),
      inertia_version: version,
      saved_at: new Date().toISOString(),
    };
    writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
    console.log(`[mygreenhouse-auth] wrote ${SESSION_FILE} (${cookies.length} cookies, version=${version})`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("[mygreenhouse-auth] failed:", err);
  process.exit(1);
});
