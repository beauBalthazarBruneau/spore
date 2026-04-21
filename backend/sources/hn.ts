// Hacker News "Who is hiring?" source. Finds the current month's thread via
// the Algolia API, walks top-level comments, and extracts URLs + title hints.
// ATS URLs are routed through ats-router for full JD data; non-ATS URLs are
// returned as minimal postings (source='hn') using the comment text as the
// description.

import type { RawPosting } from "./types";
import { enrichAtsUrls, parseAtsUrl } from "./ats-router";

const HN_ALGOLIA = "https://hn.algolia.com/api/v1";
const THREAD_AUTHOR = "whoishiring";

interface HnHit {
  objectID: string;
  title: string;
  created_at: string;
}

interface HnComment {
  id: number;
  text?: string | null;
  author?: string | null;
  created_at?: string;
  children?: HnComment[];
}

export interface HnRunReport {
  thread_id: number | null;
  comments_scanned: number;
  urls_found: number;
  ats_postings: number;
  non_ats_postings: number;
  errors: Array<{ source: string; slug?: string; error: string }>;
}

async function findCurrentHiringThread(): Promise<number | null> {
  const q = encodeURIComponent("Ask HN: Who is hiring?");
  const url = `${HN_ALGOLIA}/search_by_date?query=${q}&tags=story,author_${THREAD_AUTHOR}&hitsPerPage=3`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const body = (await res.json()) as { hits?: HnHit[] };
  const hit = body.hits?.find((h) => /who\s+is\s+hiring/i.test(h.title));
  return hit ? parseInt(hit.objectID, 10) : null;
}

async function fetchThread(id: number): Promise<HnComment | null> {
  const res = await fetch(`${HN_ALGOLIA}/items/${id}`);
  if (!res.ok) return null;
  return (await res.json()) as HnComment;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function stripHtml(s: string): string {
  return decodeEntities(
    s
      .replace(/<p>/gi, "\n\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

function extractUrls(html: string): string[] {
  // HN's Algolia API returns URLs entity-encoded (https:&#x2F;&#x2F;...), so
  // decode entities first, then scan. Stripping tags would destroy href targets.
  const decoded = decodeEntities(html);
  const urls = [...decoded.matchAll(URL_RE)].map((m) => m[0].replace(/[.,;:)\]]+$/, ""));
  return [...new Set(urls)];
}

function firstMeaningfulLine(plain: string): string | undefined {
  for (const line of plain.split("\n")) {
    const t = line.trim();
    if (t.length >= 10 && t.length <= 300) return t;
  }
  return undefined;
}

function companyFromCommentTitle(line: string): string | undefined {
  // HN convention: "Company | Role | Location | ..." — take the first segment.
  const parts = line.split(/\s*\|\s*/);
  if (parts.length >= 2 && parts[0].length <= 80) return parts[0].trim();
  return undefined;
}

export async function fetchHnHiring(): Promise<{ postings: RawPosting[]; report: HnRunReport }> {
  const report: HnRunReport = {
    thread_id: null,
    comments_scanned: 0,
    urls_found: 0,
    ats_postings: 0,
    non_ats_postings: 0,
    errors: [],
  };

  const threadId = await findCurrentHiringThread();
  report.thread_id = threadId;
  if (!threadId) return { postings: [], report };

  const thread = await fetchThread(threadId);
  if (!thread) return { postings: [], report };

  const topLevel = (thread.children ?? []).filter((c) => c.text && c.author !== THREAD_AUTHOR);
  report.comments_scanned = topLevel.length;

  const allUrls: string[] = [];
  const urlToContext = new Map<string, { comment: string; titleHint?: string; company?: string }>();

  for (const c of topLevel) {
    const html = c.text ?? "";
    const plain = stripHtml(html);
    const urls = extractUrls(html);
    const firstLine = firstMeaningfulLine(plain);
    const company = firstLine ? companyFromCommentTitle(firstLine) : undefined;

    for (const url of urls) {
      allUrls.push(url);
      if (!urlToContext.has(url)) {
        urlToContext.set(url, { comment: plain, titleHint: firstLine, company });
      }
    }
  }

  report.urls_found = allUrls.length;

  const { postings: atsPostings, errors } = await enrichAtsUrls(allUrls);
  report.errors.push(...errors);
  report.ats_postings = atsPostings.length;

  const nonAtsUrls = allUrls.filter((u) => !parseAtsUrl(u));
  const nonAtsPostings: RawPosting[] = [];
  const seen = new Set<string>();
  for (const url of nonAtsUrls) {
    if (seen.has(url)) continue;
    seen.add(url);
    const ctx = urlToContext.get(url);
    if (!ctx) continue;
    const title = ctx.titleHint ?? "Untitled HN posting";
    const companyName = ctx.company ?? new URL(url).hostname.replace(/^www\./, "");
    nonAtsPostings.push({
      source: "hn",
      source_job_id: url,
      url,
      title,
      company_name: companyName,
      description: ctx.comment,
      raw: { via: "hn-who-is-hiring", thread_id: threadId, first_line: ctx.titleHint },
    });
  }
  report.non_ats_postings = nonAtsPostings.length;

  return { postings: [...atsPostings, ...nonAtsPostings], report };
}
