// RemoteOK JSON feed — https://remoteok.com/api
// The first array element is a legal notice, the rest are postings.

import type { RawPosting } from "./types";

interface RemoteOKJob {
  id: string | number;
  slug?: string;
  position?: string;
  company?: string;
  company_logo?: string;
  url?: string;
  apply_url?: string;
  location?: string;
  description?: string;
  date?: string;
  tags?: string[];
  salary_min?: number;
  salary_max?: number;
}

export interface RemoteOkRunReport {
  fetched: number;
  errors: string[];
}

function stripHtml(s: string | undefined): string | undefined {
  if (!s) return undefined;
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toPosting(j: RemoteOKJob): RawPosting | null {
  if (!j.id || !j.position || !j.company) return null;
  const url = j.url ?? (j.slug ? `https://remoteok.com/remote-jobs/${j.slug}` : undefined);
  if (!url) return null;
  return {
    source: "remoteok",
    source_job_id: String(j.id),
    url,
    title: j.position,
    company_name: j.company,
    location: j.location,
    remote: "remote",
    salary_min: j.salary_min && j.salary_min > 0 ? j.salary_min : undefined,
    salary_max: j.salary_max && j.salary_max > 0 ? j.salary_max : undefined,
    posted_at: j.date,
    description: stripHtml(j.description),
    raw: j,
  };
}

export async function fetchRemoteOk(): Promise<{ postings: RawPosting[]; report: RemoteOkRunReport }> {
  const report: RemoteOkRunReport = { fetched: 0, errors: [] };
  try {
    const res = await fetch("https://remoteok.com/api", {
      headers: { "User-Agent": "spore-autoapply/1.0 (+https://github.com)" },
    });
    if (!res.ok) {
      report.errors.push(`remoteok: HTTP ${res.status}`);
      return { postings: [], report };
    }
    const body = (await res.json()) as unknown[];
    const jobs = body.slice(1) as RemoteOKJob[];
    const postings = jobs.map(toPosting).filter((p): p is RawPosting => p !== null);
    report.fetched = postings.length;
    return { postings, report };
  } catch (e) {
    report.errors.push((e as Error).message);
    return { postings: [], report };
  }
}
