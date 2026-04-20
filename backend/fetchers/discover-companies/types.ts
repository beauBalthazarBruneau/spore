/** A single funding-news candidate before dedup against the DB. */
export interface RawCandidate {
  company: string;
  round: string;   // "Seed" | "Series A" | "Series B" | etc.
  amount: string;   // "$20M", "$150M", etc.
  date: string;     // ISO date (YYYY-MM-DD)
  url: string;      // source article URL
  description: string;
  source: string;   // which FundingSource produced this (e.g. "techcrunch")
}

/** Same shape as RawCandidate — kept after dedup + DB filtering. */
export type Candidate = RawCandidate;

export interface FetchOpts {
  /** Absolute cutoff date — ignore articles before this. */
  cutoff: Date;
  /** Allowed round keys, lowercased (e.g. ["seed", "a", "b"]). */
  rounds: string[];
  /** Optional sector keywords — word-boundary matched against title + description. */
  sectors: string[];
}

export interface FetchResult {
  candidates: RawCandidate[];
  articles_scanned: number;
  pages_fetched: number;
}

/**
 * A funding-news source adapter. Mirrors the SourceAdapter pattern used by
 * ATS adapters in backend/sources/.
 */
export interface FundingSource {
  name: string;
  fetch(opts: FetchOpts): Promise<FetchResult>;
}
