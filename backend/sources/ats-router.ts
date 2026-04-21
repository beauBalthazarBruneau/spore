// Given arbitrary job-posting URLs, detect which ones belong to a supported
// ATS (greenhouse / lever / ashby / rippling) and fetch the full JD for those
// companies via the existing source adapters. Used by discover-jobs-generic
// to enrich URLs harvested from HN "Who's Hiring" threads, and reusable by
// SPORE-18's SERP discovery agent.

import type { RawPosting } from "./types";
import { sources } from "./index";

export interface AtsUrlMatch {
  source: string;
  slug: string;
  jobId?: string;
}

const PATTERNS: Array<{ source: string; re: RegExp }> = [
  { source: "greenhouse", re: /^https?:\/\/(?:boards|job-boards)\.greenhouse\.io\/([^/?#]+)(?:\/jobs\/(\d+))?/i },
  { source: "lever", re: /^https?:\/\/jobs\.lever\.co\/([^/?#]+)(?:\/([a-f0-9-]+))?/i },
  { source: "ashby", re: /^https?:\/\/jobs\.ashbyhq\.com\/([^/?#]+)(?:\/([a-f0-9-]+))?/i },
  { source: "rippling", re: /^https?:\/\/ats\.rippling\.com\/([^/?#]+)(?:\/jobs\/([^/?#]+))?/i },
];

export function parseAtsUrl(url: string): AtsUrlMatch | null {
  for (const { source, re } of PATTERNS) {
    const m = url.match(re);
    if (m) return { source, slug: m[1], jobId: m[2] };
  }
  return null;
}

export interface EnrichResult {
  postings: RawPosting[];
  errors: Array<{ source: string; slug: string; error: string }>;
}

/**
 * Given URLs, identify supported ATSes, fetch each (source, slug) board once,
 * and return all postings from those boards. Non-ATS URLs are ignored by this
 * router — callers handle them separately.
 *
 * Deliberately returns *all* jobs on each touched board, not just the URLs we
 * were asked about. Rationale: if someone mentioned "ACME is hiring" with a
 * greenhouse link, the user probably cares about every ACME role, and hard
 * filters + prescore will trim the list downstream.
 */
export async function enrichAtsUrls(urls: string[]): Promise<EnrichResult> {
  const slugsBySource = new Map<string, Set<string>>();
  for (const url of urls) {
    const ats = parseAtsUrl(url);
    if (!ats) continue;
    if (!slugsBySource.has(ats.source)) slugsBySource.set(ats.source, new Set());
    slugsBySource.get(ats.source)!.add(ats.slug);
  }

  const postings: RawPosting[] = [];
  const errors: EnrichResult["errors"] = [];

  for (const [source, slugs] of slugsBySource) {
    const adapter = sources[source];
    if (!adapter) continue;
    for (const slug of slugs) {
      try {
        const results = await adapter.search({ companies: [slug] });
        postings.push(...results);
      } catch (e) {
        errors.push({ source, slug, error: (e as Error).message });
      }
    }
  }

  return { postings, errors };
}
