import { chromium } from "playwright";
import type { SubmitInput, SubmitResult } from "../types";
import { fillCustomQuestions } from "../utils";

const HEADLESS = process.env.PLAYWRIGHT_HEADLESS !== "false";

/** Normalise an Ashby job URL to the /application endpoint. */
function applicationUrl(url: string): string {
  // e.g. https://jobs.ashbyhq.com/company/uuid → https://jobs.ashbyhq.com/company/uuid/application
  return url.replace(/\/?$/, "/application").replace(/\/application\/application$/, "/application");
}

export async function applyAshby(input: SubmitInput): Promise<SubmitResult> {
  if (!input.profile.email) throw new Error("Profile is missing email — cannot submit");
  if (!input.profile.resumePdfPath) throw new Error("Profile is missing resume PDF — cannot submit");

  const browser = await chromium.launch({ headless: HEADLESS });
  const page = await browser.newPage();

  try {
    const url = applicationUrl(input.url);
    const response = await page.goto(url, { waitUntil: "networkidle", timeout: 40_000 });
    if (!response || !response.ok()) {
      return { success: false, error: `Page returned ${response?.status()} for ${url}` };
    }

    // Ashby is React-rendered; wait for form hydration
    await page.waitForSelector("#_systemfield_name, #_systemfield_email", { timeout: 15_000 }).catch(() => {
      throw new Error("Ashby application form not found — page may not have loaded");
    });

    // ── Standard fields ──────────────────────────────────────────────────────

    await page.locator("#_systemfield_name").fill(input.profile.fullName);
    await page.locator("#_systemfield_email").fill(input.profile.email);

    // Phone (not always present on Ashby forms)
    if (input.profile.phone) {
      const phone = page.locator("#_systemfield_phone").first();
      if (await phone.count() > 0) await phone.fill(input.profile.phone);
    }

    // Resume upload — Ashby uses #_systemfield_resume
    const resumeInput = page.locator("#_systemfield_resume").first();
    if (await resumeInput.count() > 0) {
      await resumeInput.setInputFiles(input.profile.resumePdfPath);
      // Wait for upload to register
      await page.waitForTimeout(1000);
    }

    // Cover letter (optional textarea if present)
    if (input.profile.coverLetterPdfPath) {
      const clTextarea = page.locator("textarea[id*='cover'], textarea[placeholder*='cover' i]").first();
      if (await clTextarea.count() > 0) {
        // Ashby cover letter is a text area — skip file upload, leave for manual
      }
    }

    // LinkedIn — Ashby uses a text input with label "LinkedIn Profile" or "LinkedIn"
    if (input.profile.linkedinUrl) {
      const li = page.getByLabel(/LinkedIn/i).first();
      if (await li.count() > 0) await li.fill(input.profile.linkedinUrl);
    }

    // ── EEOC radio buttons — "Decline to self-identify" ─────────────────────
    // Ashby EEOC fields use radio inputs with name containing "_systemfield_eeoc_"
    const eeocNames = await page.evaluate(() => {
      const radios = Array.from(document.querySelectorAll("input[type='radio']")) as HTMLInputElement[];
      return [...new Set(radios.map((r) => r.name).filter((n) => n.includes("eeoc")))];
    });

    for (const groupName of eeocNames) {
      // Find the "Decline to self-identify" radio in this group
      const declineRadio = page
        .locator(`input[type='radio'][name="${groupName}"]`)
        .filter({ hasText: /decline/i })
        .first();
      if (await declineRadio.count() > 0) {
        await declineRadio.check();
        continue;
      }
      // Fallback: find by sibling label text
      const radios = page.locator(`input[type='radio'][name="${groupName}"]`);
      const count = await radios.count();
      for (let i = 0; i < count; i++) {
        const radio = radios.nth(i);
        const id = await radio.getAttribute("id");
        if (!id) continue;
        const label = await page.locator(`label[for="${id}"]`).textContent().catch(() => "");
        if (/decline/i.test(label ?? "")) {
          await radio.check();
          break;
        }
      }
    }

    // ── Custom questions ─────────────────────────────────────────────────────
    await fillCustomQuestions(page, input.questions);

    // ── Pagination: click through Next/Continue buttons ──────────────────────
    let paginationAttempts = 0;
    while (paginationAttempts < 5) {
      const nextBtn = page.locator("button:has-text('Next'), button:has-text('Continue')").first();
      if (await nextBtn.count() === 0) break;
      const submitVisible = await page.locator("button:has-text('Submit Application')").count() > 0;
      if (submitVisible) break;
      await nextBtn.click();
      await page.waitForTimeout(1500);
      paginationAttempts++;
    }

    // ── Submit ───────────────────────────────────────────────────────────────
    const submitBtn = page.locator("button:has-text('Submit Application'), button[type='submit']").first();
    if (await submitBtn.count() === 0) {
      return { success: false, error: "Submit button not found on Ashby form" };
    }

    await submitBtn.click();
    await page.waitForTimeout(4000);

    const finalUrl = page.url();
    const bodyText = (await page.locator("body").textContent().catch(() => "")) ?? "";
    const pageTitle = await page.title();

    // Ashby shows confirmation on same page or navigates to a thank-you state
    if (/thank you|application submitted|successfully submitted|we.ll be in touch/i.test(bodyText) ||
        /thank you|submitted/i.test(pageTitle)) {
      return { success: true, confirmationRef: finalUrl };
    }

    // Check for validation errors
    const errors = await page.locator("[class*='error'], [role='alert']").allTextContents();
    if (errors.some((e) => e.trim())) {
      return { success: false, error: `Form error: ${errors.filter(Boolean).slice(0, 3).join("; ")}` };
    }

    return { success: false, error: `Unexpected post-submit state — title: "${pageTitle}", url: ${finalUrl}` };
  } finally {
    await browser.close();
  }
}
