/**
 * Ashby-specific probe: navigates to the /application URL, waits for React
 * hydration, and extracts custom fields using Ashby's known DOM conventions:
 *   - Standard fields have ids/names starting with "_systemfield_"
 *   - EEOC fields have "eeoc" in the name — skipped automatically
 *   - Radio/checkbox groups live in <fieldset>/<legend> pairs
 */

import type { Page } from "playwright";

export type ProbeField = {
  label: string;
  fieldType: string;
  name: string | null;
  id: string | null;
  index: number;
  options?: string[];
};

function applicationUrl(url: string): string {
  return url.replace(/\/?$/, "/application").replace(/\/application\/application$/, "/application");
}

export async function extractAshbyFields(page: Page, jobUrl: string): Promise<ProbeField[]> {
  const appUrl = applicationUrl(jobUrl);
  const response = await page.goto(appUrl, { waitUntil: "networkidle", timeout: 40_000 });

  if (!response || !response.ok()) {
    throw new Error(`Ashby application page returned ${response?.status()} for ${appUrl}`);
  }

  await page.waitForSelector("#_systemfield_name, #_systemfield_email", { timeout: 15_000 });
  await page.waitForTimeout(500);

  // page.evaluate serialises via .toString() — esbuild's __name helper won't be
  // present in the browser context, so pass a plain string to avoid that injection.
  //
  // Ashby uses `.ashby-application-form-question-title` as the canonical question
  // label on every field type (text, radio group, checkbox). We walk up the DOM
  // to find it rather than relying on <legend> (which Ashby doesn't use) or
  // standard label[for] associations.
  return page.evaluate(`
    (() => {
      const results = [];
      const seen = new Set();

      // Walk up from an element to find the nearest Ashby question title
      const getQuestionLabel = (el) => {
        let node = el.parentElement;
        for (let i = 0; i < 8 && node; i++) {
          const title = node.querySelector(".ashby-application-form-question-title");
          if (title) return title.textContent?.trim() ?? "";
          node = node.parentElement;
        }
        return "";
      };

      // Skip _systemfield_* (standard Ashby contact fields) and EEOC
      const STD_LABELS = /^(name|full.?name|first.?name|last.?name|email|phone|phone.?number|linkedin|linkedin.?url|linkedin.?profile|github|github.?url|portfolio|website|resume|cv|cover.?letter)$/i;
      const isSys = (el, questionLabel) => {
        const id = el.id ?? "";
        const nm = el.name ?? "";
        if (id.startsWith("_systemfield_") || nm.startsWith("_systemfield_") || nm.includes("eeoc")) return true;
        if (STD_LABELS.test(questionLabel)) return true;
        return false;
      };

      // ── Radio groups via fieldset ─────────────────────────────────────────
      // Ashby uses <label class="ashby-application-form-question-title"> (not <legend>)
      Array.from(document.querySelectorAll("fieldset")).forEach((fs, idx) => {
        const titleEl = fs.querySelector(".ashby-application-form-question-title");
        const groupLabel = titleEl?.textContent?.trim() ?? "";
        if (!groupLabel) return;

        const inputs = Array.from(fs.querySelectorAll("input[type='radio'], input[type='checkbox']"));
        if (!inputs.length) return;
        if (isSys(inputs[0], groupLabel)) return;

        const key = "fieldset|" + groupLabel;
        if (seen.has(key)) return;
        seen.add(key);

        const options = inputs
          .map((inp) => {
            const lbl = inp.id ? document.querySelector('label[for="' + inp.id + '"]') : null;
            return lbl?.textContent?.trim() ?? "";
          })
          .filter(Boolean);

        results.push({
          label: groupLabel,
          fieldType: inputs[0].type,
          name: inputs[0].name || null,
          id: inputs[0].id || null,
          index: idx,
          options,
        });
      });

      // ── Text inputs, textareas, checkboxes outside fieldsets ─────────────
      Array.from(document.querySelectorAll("input:not(fieldset input), textarea:not(fieldset textarea)")).forEach((el, idx) => {
        const inputType = el.tagName.toLowerCase() === "textarea" ? "textarea" : (el.type || "text");
        if (["hidden","submit","button","file","image","reset"].includes(inputType)) return;

        const questionLabel = getQuestionLabel(el);
        if (!questionLabel) return;
        if (isSys(el, questionLabel)) return;

        const nm = el.name || null;
        const key = questionLabel + "|" + nm;
        if (seen.has(key)) return;
        seen.add(key);

        results.push({ label: questionLabel, fieldType: inputType, name: nm, id: el.id || null, index: idx });
      });

      return results;
    })()
  `) as Promise<ProbeField[]>;
}
