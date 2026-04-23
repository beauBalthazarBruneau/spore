import type { Page } from "playwright";
import type { ApplicationQuestion } from "./types";

/** Fill custom form questions using stored fieldSelector and fieldType. */
export async function fillCustomQuestions(page: Page, questions: ApplicationQuestion[]): Promise<void> {
  for (const q of questions) {
    if (!q.answer || !q.fieldSelector) continue;

    try {
      const locator = page.locator(q.fieldSelector).first();
      const count = await locator.count();
      if (count === 0) {
        console.warn(`[submitter] selector not found for question: "${q.question}" (${q.fieldSelector})`);
        continue;
      }

      switch (q.fieldType) {
        case "textarea":
        case "text":
          await locator.fill(q.answer);
          break;
        case "select":
          await locator.selectOption({ label: q.answer });
          break;
        case "checkbox":
          if (q.answer.toLowerCase() === "true" || q.answer.toLowerCase() === "yes") {
            await locator.check();
          } else {
            await locator.uncheck();
          }
          break;
        case "radio":
          // Radio groups: find sibling with matching value/label
          await page.locator(`${q.fieldSelector}[value="${q.answer}"]`).check().catch(() =>
            page.getByLabel(q.answer!).check()
          );
          break;
        default:
          await locator.fill(q.answer);
      }
    } catch (e) {
      console.warn(`[submitter] failed to fill question "${q.question}":`, (e as Error).message);
    }
  }
}

/** Find a label-relative text input or textarea by partial label text. */
export async function fillByLabel(page: Page, labelText: string, value: string): Promise<boolean> {
  try {
    const field = page.getByLabel(new RegExp(labelText, "i")).first();
    if (await field.count() === 0) return false;
    await field.fill(value);
    return true;
  } catch {
    return false;
  }
}
