# Funding discovery sources

Scrapes free funding-news feeds for recently-funded companies (Seed/A/B by default). Each source is its own module implementing the `FundingSource` interface. The orchestrator in `index.ts` runs all sources in parallel, merges results, dedupes across sources and against existing companies in the DB.

Output is a candidate list — this stage does **not** write to the DB. The `add-companies` skill handles ATS enrichment and upsert.

## Usage

```bash
# Default: Seed/A/B, last 3 months
npm run discover

# Custom window + rounds
npx tsx backend/orchestrate.ts --name discover-companies --months 2 --rounds seed,a,b

# Sector-filtered (word-boundary match against title + description)
npx tsx backend/orchestrate.ts --name discover-companies --sector ai,devtools
```

## Current sources

| Source | File | How it works |
|---|---|---|
| TechCrunch | `techcrunch.ts` | Paginated RSS feed from `/category/fundraising/feed/`. ~20 items/page, walks back until it passes the cutoff date. |
| Google News | `google-news.ts` | Single RSS search query scoped to funding terms + time window. Broadens coverage beyond TC. |

## Adding a new source

1. Create a new file (e.g. `venturebeat.ts`) that exports a `FundingSource`:

```ts
import type { FundingSource, FetchOpts, FetchResult } from "./types";
import { parseRssItems, extractFunding, roundMatches, sectorMatches } from "./parse";

export const venturebeat: FundingSource = {
  name: "venturebeat",
  async fetch(opts: FetchOpts): Promise<FetchResult> {
    // Fetch your feed, parse items, filter by opts.cutoff/rounds/sectors
    // Return { candidates, articles_scanned, pages_fetched }
  },
};
```

2. Register it in `index.ts`:

```ts
import { venturebeat } from "./venturebeat";

const fundingSources: FundingSource[] = [
  techcrunch,
  googleNews,
  venturebeat,  // add here
];
```

That's it. The orchestrator handles parallel execution, cross-source dedup, and DB dedup. If your source fails at runtime, the others still return results (`Promise.allSettled`).

## Shared utilities (`parse.ts`)

Most funding news sources use RSS and similar headline patterns, so `parse.ts` provides reusable helpers:

- `parseRssItems(xml)` — regex-based RSS XML parser (no dependencies)
- `extractFunding(title)` — extracts company name, round, and amount from headline patterns like "Acme raises $20M Series A"
- `cleanCompanyName(raw)` — strips prefixes ("Exclusive:"), lead-in descriptors ("AI startup Foo"), possessives, trademark symbols
- `roundMatches(round, allowed)` — checks if a normalized round matches the allowed list
- `sectorMatches(title, description, sectors)` — word-boundary keyword match

If your source isn't RSS-based, you only need `extractFunding` and the filtering helpers — the RSS parser is optional.

## Key types (`types.ts`)

```ts
interface FundingSource {
  name: string;
  fetch(opts: FetchOpts): Promise<FetchResult>;
}

interface FetchOpts {
  cutoff: Date;        // ignore articles before this
  rounds: string[];    // e.g. ["seed", "a", "b"]
  sectors: string[];   // optional keyword filter
}

interface FetchResult {
  candidates: RawCandidate[];
  articles_scanned: number;
  pages_fetched: number;
}
```
