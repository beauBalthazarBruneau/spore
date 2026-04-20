// Google News RSS search — searches for funding-related headlines across
// all publications. Single (non-paginated) feed, but covers sources that
// TechCrunch doesn't.

import type { FundingSource, FetchOpts, FetchResult, RawCandidate } from "./types";
import { parseRssItems, extractFunding, roundMatches, sectorMatches } from "./parse";

function buildFeedUrl(opts: FetchOpts): string {
  // Google News RSS search supports time-restricted queries via "when:Nd".
  const days = Math.ceil((Date.now() - opts.cutoff.getTime()) / (1000 * 60 * 60 * 24));

  // Build search terms for the rounds we care about.
  const roundTerms: string[] = [];
  for (const r of opts.rounds) {
    const lower = r.toLowerCase();
    if (lower === "seed") roundTerms.push('"raises seed"', '"raised seed"', '"seed round"', '"seed funding"');
    else if (lower === "pre-seed") roundTerms.push('"pre-seed"');
    else if (lower.length === 1) {
      // a, b, c, d, e → Series A, Series B, etc.
      const letter = lower.toUpperCase();
      roundTerms.push(`"Series ${letter}"`);
    } else {
      roundTerms.push(`"${r}"`);
    }
  }

  let q = roundTerms.join(" OR ");

  // Sector keywords narrow the search when provided
  if (opts.sectors.length > 0) {
    const sectorTerms = opts.sectors.map((s) => `"${s}"`).join(" OR ");
    q = `(${q}) (${sectorTerms})`;
  }

  q += ` when:${days}d`;

  const params = new URLSearchParams({
    q,
    hl: "en-US",
    gl: "US",
    ceid: "US:en",
  });
  return `https://news.google.com/rss/search?${params}`;
}

export const googleNews: FundingSource = {
  name: "google-news",

  async fetch(opts: FetchOpts): Promise<FetchResult> {
    const url = buildFeedUrl(opts);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Google News RSS fetch failed: ${res.status} ${res.statusText}`);
    }
    const xml = await res.text();
    const items = parseRssItems(xml);

    const candidates: RawCandidate[] = [];
    const seen = new Set<string>();

    for (const item of items) {
      const pubDate = new Date(item.pubDate);
      if (pubDate < opts.cutoff) continue;

      const funding = extractFunding(item.title);
      if (!funding) continue;
      if (!roundMatches(funding.round, opts.rounds)) continue;
      // Sector filter already applied via search query, but double-check
      if (!sectorMatches(item.title, item.description, opts.sectors)) continue;

      const key = funding.company.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      candidates.push({
        company: funding.company,
        round: funding.round,
        amount: funding.amount,
        date: pubDate.toISOString().split("T")[0],
        url: item.link,
        description: item.description.slice(0, 200),
        source: "google-news",
      });
    }

    return {
      candidates,
      articles_scanned: items.length,
      pages_fetched: 1,
    };
  },
};
