// TechCrunch fundraising RSS feed — paginated, ~20 items per page.

import type { FundingSource, FetchOpts, FetchResult, RawCandidate } from "./types";
import { parseRssItems, extractFunding, roundMatches, sectorMatches } from "./parse";

const FEED_URL = "https://techcrunch.com/category/fundraising/feed/";
const MAX_PAGES = 10;

async function fetchPage(page: number): Promise<string> {
  const url = page <= 1 ? FEED_URL : `${FEED_URL}?paged=${page}`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) return ""; // past the end
    throw new Error(`TechCrunch RSS fetch failed: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

export const techcrunch: FundingSource = {
  name: "techcrunch",

  async fetch(opts: FetchOpts): Promise<FetchResult> {
    const candidates: RawCandidate[] = [];
    const seen = new Set<string>();
    let articlesScanned = 0;
    let pagesFetched = 0;

    for (let page = 1; page <= MAX_PAGES; page++) {
      const xml = await fetchPage(page);
      if (!xml) break;
      pagesFetched++;

      const items = parseRssItems(xml);
      if (items.length === 0) break;

      let allBeforeCutoff = true;

      for (const item of items) {
        articlesScanned++;
        const pubDate = new Date(item.pubDate);
        if (pubDate < opts.cutoff) continue;
        allBeforeCutoff = false;

        const funding = extractFunding(item.title);
        if (!funding) continue;
        if (!roundMatches(funding.round, opts.rounds)) continue;
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
          source: "techcrunch",
        });
      }

      if (allBeforeCutoff) break;
    }

    return { candidates, articles_scanned: articlesScanned, pages_fetched: pagesFetched };
  },
};
