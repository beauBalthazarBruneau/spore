import type { RawPosting, SearchOpts, SourceAdapter } from "./types";
import { extractSalaryFromText, extractRemoteFromText } from "./extract";

// Greenhouse exposes a public JSON board per company:
//   https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true
// `slug` is the company's Greenhouse board identifier (usually lowercase name).
interface GHJob {
  id: number;
  absolute_url: string;
  title: string;
  updated_at?: string;
  location?: { name?: string };
  content?: string;
  metadata?: Array<{ name: string; value: unknown }> | null;
  offices?: Array<{ name?: string; location?: string }>;
}

async function fetchBoard(slug: string): Promise<GHJob[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`greenhouse ${slug}: ${res.status}`);
  const body = (await res.json()) as { jobs?: GHJob[] };
  return body.jobs ?? [];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function stripHtml(s: string | undefined): string | undefined {
  if (!s) return undefined;
  // Greenhouse double-encodes: decode entities first, then strip tags.
  const decoded = decodeEntities(s);
  return decoded
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toPosting(slug: string, j: GHJob): RawPosting {
  const description = stripHtml(j.content);
  const { min, max, range } = extractSalaryFromText(description);
  const remote = extractRemoteFromText(description);
  return {
    source: "greenhouse",
    source_job_id: String(j.id),
    url: j.absolute_url,
    title: j.title,
    company_name: slug,
    location: j.location?.name,
    remote,
    salary_min: min,
    salary_max: max,
    salary_range: range,
    posted_at: j.updated_at,
    description,
    raw: j,
  };
}

export const greenhouse: SourceAdapter = {
  name: "greenhouse",
  async search(opts: SearchOpts): Promise<RawPosting[]> {
    const slugs = opts.companies ?? [];
    const out: RawPosting[] = [];
    for (const slug of slugs) {
      try {
        const jobs = await fetchBoard(slug);
        const limited = opts.maxPerCompany ? jobs.slice(0, opts.maxPerCompany) : jobs;
        for (const j of limited) out.push(toPosting(slug, j));
      } catch (err) {
        console.error(`[greenhouse] ${slug} failed:`, (err as Error).message);
      }
    }
    return out;
  },
};
