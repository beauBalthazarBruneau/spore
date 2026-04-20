// Shared RSS parsing and funding-title extraction used by all RSS-based
// funding sources (TechCrunch, Google News, etc.).

// ---------------------------------------------------------------------------
// RSS parsing (no deps — regex over XML)
// ---------------------------------------------------------------------------

export interface RssItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
}

export function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    items.push({
      title: extractTag(block, "title"),
      link: extractTag(block, "link"),
      pubDate: extractTag(block, "pubDate"),
      description: stripHtml(extractTag(block, "description")),
    });
  }
  return items;
}

export function extractTag(xml: string, tag: string): string {
  // Handle both plain text and CDATA-wrapped content
  const re = new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`);
  const m = xml.match(re);
  return m ? m[1].trim() : "";
}

export function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Funding extraction from article titles
// ---------------------------------------------------------------------------

// Matches patterns like:
//   "Acme raises $20M Series A ..."
//   "Acme raises $150 million in seed funding ..."
//   "Acme announces $20M seed round ..."
//   "Acme closes $50M Series B led by ..."
//   "Acme nabs $10M in Series A funding ..."
const FUNDING_RE =
  /^(.+?)\s+(?:raises?|closes?|announces?|nabs?|secures?|lands?|gets?|bags?|pulls?\s+in|snags?|locks?\s+in|nets?)\s+\$([0-9,.]+)\s*([BMK](?:illion)?|million|billion)?\s*(?:in\s+)?(?:a\s+)?(seed|pre-seed|series\s+[a-e]|venture)\s*/i;

// Fallback: amount after round name — "Series A round of $20M"
const FUNDING_RE_ALT =
  /^(.+?)\s+.*?(seed|pre-seed|series\s+[a-e])\s+(?:round\s+)?(?:of\s+)?\$([0-9,.]+)\s*([BMK](?:illion)?|million|billion)?/i;

export interface FundingMatch {
  company: string;
  round: string;
  amount: string;
}

export function extractFunding(title: string): FundingMatch | null {
  let m = title.match(FUNDING_RE);
  if (m) {
    return {
      company: cleanCompanyName(m[1]),
      round: normalizeRound(m[4]),
      amount: normalizeAmount(m[2], m[3]),
    };
  }

  m = title.match(FUNDING_RE_ALT);
  if (m) {
    return {
      company: cleanCompanyName(m[1]),
      round: normalizeRound(m[2]),
      amount: normalizeAmount(m[3], m[4]),
    };
  }

  return null;
}

export function cleanCompanyName(raw: string): string {
  return raw
    .replace(/^(exclusive:\s*|breaking:\s*)/i, "")
    // Strip lead-in descriptors: "AI-powered fintech startup Acme" → "Acme"
    // Matches everything up to and including the last "startup|company|platform|firm|provider|maker" word
    .replace(/^.*\b(?:startup|company|platform|firm|provider|maker|start-up)\s+/i, "")
    .replace(/['']s$/i, "") // "Acme's" → "Acme"
    .replace(/[™®]$/g, "") // "Antaris™" → "Antaris"
    .trim();
}

export function normalizeRound(raw: string): string {
  const lower = raw.toLowerCase().trim();
  if (lower === "seed" || lower === "pre-seed") return lower.charAt(0).toUpperCase() + lower.slice(1);
  if (lower === "venture") return "Venture";
  // "series a" → "Series A"
  return "Series " + lower.replace("series ", "").toUpperCase();
}

export function normalizeAmount(num: string, suffix?: string): string {
  const n = parseFloat(num.replace(/,/g, ""));
  const s = (suffix ?? "").toLowerCase();
  if (s.startsWith("b")) return `$${n}B`;
  if (s.startsWith("m") || s === "") return `$${n}M`;
  if (s.startsWith("k")) return `$${n}K`;
  return `$${n}M`;
}

export function roundMatches(round: string, allowed: string[]): boolean {
  const key = round.toLowerCase().replace("series ", "");
  return allowed.some((a) => a.toLowerCase() === key || a.toLowerCase() === round.toLowerCase());
}

export function sectorMatches(title: string, description: string, sectors: string[]): boolean {
  if (sectors.length === 0) return true;
  const text = `${title} ${description}`;
  return sectors.some((s) => new RegExp(`\\b${s}\\b`, "i").test(text));
}
