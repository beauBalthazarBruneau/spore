import { chromium } from "playwright";
import type { SubmitInput, SubmitResult } from "../types";
import { fillCustomQuestions } from "../utils";

const HEADLESS = process.env.PLAYWRIGHT_HEADLESS !== "false";

/** Normalise a Lever job URL to the /apply endpoint. */
function applyUrl(url: string): string {
  // e.g. https://jobs.lever.co/company/uuid → https://jobs.lever.co/company/uuid/apply
  return url.replace(/\/?$/, "/apply").replace(/\/apply\/apply$/, "/apply");
}

export async function applyLever(input: SubmitInput): Promise<SubmitResult> {
  if (!input.profile.email) throw new Error("Profile is missing email — cannot submit");
  if (!input.profile.resumePdfPath) throw new Error("Profile is missing resume PDF — cannot submit");

  const browser = await chromium.launch({ headless: HEADLESS });
  const page = await browser.newPage();

  try {
    const url = applyUrl(input.url);
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (!response || !response.ok()) {
      return { success: false, error: `Page returned ${response?.status()} for ${url}` };
    }

    await page.waitForSelector("input[name='name'], input[name='email']", { timeout: 10_000 }).catch(() => {
      throw new Error("Lever application form not found on page");
    });

    // ── Standard fields ──────────────────────────────────────────────────────

    // Lever uses full name in a single field
    await page.locator("input[name='name']").fill(input.profile.fullName);
    await page.locator("input[name='email']").fill(input.profile.email);

    if (input.profile.phone) {
      const phone = page.locator("input[name='phone']").first();
      if (await phone.count() > 0) await phone.fill(input.profile.phone);
    }

    if (input.profile.location) {
      const loc = page.locator("input[name='location'], #location-input").first();
      if (await loc.count() > 0) await loc.fill(input.profile.city || input.profile.location);
    }

    // Resume — Lever uses a file input with name="resume" or id="resume-upload-input"
    const resumeInput = page.locator("input[type='file'][name='resume'], #resume-upload-input").first();
    if (await resumeInput.count() > 0) {
      await resumeInput.setInputFiles(input.profile.resumePdfPath);
    }

    // Cover letter — Lever uses a textarea (text, not file)
    if (input.profile.coverLetterPdfPath === null) {
      // No cover letter blob — skip
    } else {
      // If there's a cover letter textarea, fill it (cover letter text would come from cover_letter_md)
      const clTextarea = page.locator("textarea[name='comments'], textarea[placeholder*='cover']").first();
      if (await clTextarea.count() > 0) {
        // We don't have markdown text here; leave it empty rather than uploading a PDF path
      }
    }

    // Social links
    if (input.profile.linkedinUrl) {
      const li = page.locator("input[name='urls[LinkedIn]']").first();
      if (await li.count() > 0) await li.fill(input.profile.linkedinUrl);
    }
    if (input.profile.githubUrl) {
      const gh = page.locator("input[name='urls[GitHub]']").first();
      if (await gh.count() > 0) await gh.fill(input.profile.githubUrl);
    }
    if (input.profile.portfolioUrl) {
      // Lever has various portfolio field names
      const portfolio = page
        .locator("input[name='urls[Portfolio]'], input[name='urls[Other]'], input[name='urls[Design Portfolio]']")
        .first();
      if (await portfolio.count() > 0) await portfolio.fill(input.profile.portfolioUrl);
    }

    // ── Custom questions ─────────────────────────────────────────────────────
    await fillCustomQuestions(page, input.questions);

    // ── Submit ───────────────────────────────────────────────────────────────
    // Lever's visible submit button is #btn-submit (type="button") — it triggers hCaptcha
    // which then calls the real hidden hcaptchaSubmitBtn.
    const submitBtn = page.locator("#btn-submit, button:has-text('Submit application')").first();
    if (await submitBtn.count() === 0) {
      return { success: false, error: "Submit button not found on Lever form" };
    }

    await submitBtn.click();
    await page.waitForTimeout(4000);

    const finalUrl = page.url();
    const bodyText = (await page.locator("body").textContent().catch(() => "")) ?? "";
    const pageTitle = await page.title();

    // Lever confirmation: "Application submitted" heading or thank you page
    if (/application submitted|thank you|thanks for applying/i.test(bodyText) ||
        /submitted|thank/i.test(pageTitle)) {
      return { success: true, confirmationRef: finalUrl };
    }

    // hCaptcha / bot detection
    if (/captcha|hcaptcha|robot/i.test(bodyText)) {
      return { success: false, error: "Blocked by hCaptcha — manual submission required" };
    }

    // hCaptcha iframe visible means it triggered but wasn't solved
    const captchaVisible = await page.locator("iframe[src*='hcaptcha'], iframe[src*='captcha']").count() > 0;
    if (captchaVisible) {
      return { success: false, error: "Blocked by hCaptcha — manual submission required" };
    }

    // Check for validation errors
    const errors = await page.locator(".error, [class*='error']").allTextContents();
    if (errors.filter(Boolean).length > 0) {
      return { success: false, error: `Form validation error: ${errors.filter(Boolean).slice(0, 3).join("; ")}` };
    }

    return { success: false, error: `Unexpected post-submit state — title: "${pageTitle}", url: ${finalUrl}` };
  } finally {
    await browser.close();
  }
}
