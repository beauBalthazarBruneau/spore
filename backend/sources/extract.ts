// Extract structured salary and remote signals from job description text.
// Used by adapters (greenhouse, lever) that don't return structured comp data
// from their API, but often include it in the description body.

/** Extract salary range from description text. Returns { min, max, range } or empty. */
export function extractSalaryFromText(description: string | undefined): {
  min?: number;
  max?: number;
  range?: string;
} {
  if (!description) return {};

  // Match "$X,XXX" or "$XXXK" optionally followed by "- $Y,YYY" or "to $Y,YYY"
  const m = description.match(
    /\$\s?([\d,]+(?:\.\d+)?)\s*([Kk])?\s*(?:[-–—to]+\s*\$?\s*([\d,]+(?:\.\d+)?)\s*([Kk])?)?/,
  );
  if (!m) return {};

  let low = parseFloat(m[1].replace(/,/g, ""));
  if (m[2]) low *= 1000;

  // Filter out tiny numbers (not salary — e.g. "$5 million in funding")
  if (low < 20000) return {};

  let high: number | undefined;
  if (m[3]) {
    high = parseFloat(m[3].replace(/,/g, ""));
    if (m[4]) high *= 1000;
    if (high < low) high = undefined; // bad parse
  }

  return {
    min: low,
    max: high,
    range: m[0].trim(),
  };
}

/** Extract remote/hybrid/onsite signal from description text. */
export function extractRemoteFromText(description: string | undefined): string | undefined {
  if (!description) return undefined;
  const lower = description.toLowerCase();

  // Look for explicit remote/hybrid markers (avoid matching "remote" inside other words)
  if (/\bfully\s+remote\b/.test(lower) || /\bremote[\s-]+first\b/.test(lower)) return "remote";
  if (/\bhybrid\b/.test(lower)) return "hybrid";
  if (/\bremote\b/.test(lower)) return "remote";
  if (/\bon[\s-]?site\b/.test(lower) || /\bin[\s-]?office\b/.test(lower)) return "onsite";

  return undefined;
}
