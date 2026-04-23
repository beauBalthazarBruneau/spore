import { chromium } from "playwright";
import type { SubmitInput, SubmitResult } from "../types";
import { fillCustomQuestions, fillByLabel } from "../utils";

const HEADLESS = process.env.PLAYWRIGHT_HEADLESS !== "false";

const EEOC_LABEL_PATTERNS = [
  /gender/i,
  /race/i,
  /ethnicity/i,
  /veteran/i,
  /disability/i,
  /hispanic/i,
];

export async function applyGreenhouse(input: SubmitInput): Promise<SubmitResult> {
  if (!input.profile.email) throw new Error("Profile is missing email — cannot submit");
  if (!input.profile.resumePdfPath) throw new Error("Profile is missing resume PDF — cannot submit");

  const browser = await chromium.launch({ headless: HEADLESS });
  const page = await browser.newPage();

  try {
    const response = await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (!response || !response.ok()) {
      return { success: false, error: `Page returned ${response?.status()} for ${input.url}` };
    }

    await page.waitForSelector("#first_name, #email", { timeout: 10_000 }).catch(() => {
      throw new Error("Greenhouse application form not found — URL may not be an apply page");
    });

    // ── Standard fields ──────────────────────────────────────────────────────
    await page.locator("#first_name").fill(input.profile.firstName);
    await page.locator("#last_name").fill(input.profile.lastName);
    await page.locator("#email").fill(input.profile.email);

    if (input.profile.phone) {
      const phoneField = page.locator("#phone").first();
      if (await phoneField.count() > 0) await phoneField.fill(input.profile.phone);
    }

    // Country — Greenhouse uses a text input not an autocomplete on newer boards
    const countryField = page.locator("#country").first();
    if (await countryField.count() > 0 && input.profile.country) {
      await countryField.fill(input.profile.country);
    }

    // Resume upload
    const resumeInput = page.locator("#resume").first();
    if (await resumeInput.count() > 0) {
      await resumeInput.setInputFiles(input.profile.resumePdfPath);
    }

    // Cover letter file (optional — not on all forms)
    const coverInput = page.locator("input[type='file'][id*='cover']").first();
    if (await coverInput.count() > 0 && input.profile.coverLetterPdfPath) {
      await coverInput.setInputFiles(input.profile.coverLetterPdfPath);
    }

    // LinkedIn
    if (input.profile.linkedinUrl) {
      await fillByLabel(page, "LinkedIn", input.profile.linkedinUrl);
    }

    // Website / Portfolio
    if (input.profile.portfolioUrl) {
      await fillByLabel(page, "Website|Portfolio", input.profile.portfolioUrl);
    }

    // ── EEOC selects — decline all ───────────────────────────────────────────
    const selects = await page.locator("select").all();
    for (const select of selects) {
      const id = (await select.getAttribute("id")) ?? "";
      const labelText = id
        ? (await page.locator(`label[for="${id}"]`).textContent().catch(() => "")) ?? ""
        : "";
      if (!EEOC_LABEL_PATTERNS.some((re) => re.test(labelText))) continue;
      const options = await select.locator("option").allTextContents();
      const decline = options.find((o) => /decline/i.test(o));
      if (decline) await select.selectOption({ label: decline });
    }

    // ── Custom questions ─────────────────────────────────────────────────────
    await fillCustomQuestions(page, input.questions);

    // ── Submit ───────────────────────────────────────────────────────────────
    const submitBtn = page.locator("input[type='submit'], button[type='submit']").first();
    if (await submitBtn.count() === 0) {
      return { success: false, error: "Submit button not found on Greenhouse form" };
    }

    await submitBtn.click();
    await page.waitForTimeout(3000);

    const finalUrl = page.url();
    const pageTitle = await page.title();
    const bodyText = (await page.locator("body").textContent().catch(() => "")) ?? "";

    // Success detection
    if (/thank you|application submitted|successfully submitted|we.ll be in touch/i.test(bodyText) ||
        /thank you|submitted/i.test(pageTitle)) {
      return { success: true, confirmationRef: finalUrl };
    }

    // reCAPTCHA block
    if (/recaptcha|captcha|robot/i.test(bodyText)) {
      return { success: false, error: "Blocked by reCAPTCHA — manual submission required" };
    }

    // Still on form — validation error
    if (await page.locator("#first_name").count() > 0) {
      const errors = await page.locator("[class*='error'], [class*='invalid'], .field_with_errors").allTextContents();
      return { success: false, error: `Form validation error: ${errors.slice(0, 3).join("; ") || "unknown"}` };
    }

    return { success: false, error: `Unexpected post-submit state — title: "${pageTitle}", url: ${finalUrl}` };
  } finally {
    await browser.close();
  }
}
