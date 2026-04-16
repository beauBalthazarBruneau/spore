import type { RawPosting, SearchOpts, SourceAdapter } from "./types";

// Ashby: https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true
interface AshbyAddress {
  postalAddress?: {
    addressLocality?: string;
    addressRegion?: string;
    addressCountry?: string;
  };
}
interface AshbyComp {
  compensationTierSummary?: string;
  summaryComponents?: Array<{
    compensationType?: string;
    interval?: string;
    currencyCode?: string;
    minValue?: number;
    maxValue?: number;
  }>;
}
interface AshbyJob {
  id: string;
  title: string;
  department?: string;
  team?: string;
  employmentType?: string;
  location?: string;
  isRemote?: boolean | null;
  workplaceType?: string | null;
  publishedAt?: string;
  jobUrl: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  address?: AshbyAddress;
  compensation?: AshbyComp;
  secondaryLocations?: Array<{ location?: string }>;
}

async function fetchBoard(slug: string): Promise<AshbyJob[]> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ashby ${slug}: ${res.status}`);
  const body = (await res.json()) as { jobs?: AshbyJob[] };
  return body.jobs ?? [];
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

function extractSalary(comp: AshbyComp | undefined): { min?: number; max?: number; range?: string } {
  if (!comp) return {};
  const salary = comp.summaryComponents?.find(
    (c) => c.compensationType === "Salary" || c.interval === "1 YEAR",
  );
  return {
    min: salary?.minValue,
    max: salary?.maxValue,
    range: comp.compensationTierSummary,
  };
}

function toPosting(slug: string, j: AshbyJob): RawPosting {
  const { min, max, range } = extractSalary(j.compensation);
  const remote =
    j.isRemote === true
      ? "remote"
      : j.workplaceType ?? (j.isRemote === false ? "onsite" : undefined);
  return {
    source: "ashby",
    source_job_id: j.id,
    url: j.jobUrl,
    title: j.title,
    company_name: slug,
    location: j.location,
    remote,
    salary_min: min,
    salary_max: max,
    salary_range: range,
    posted_at: j.publishedAt,
    description: j.descriptionPlain ?? stripHtml(j.descriptionHtml),
    raw: j,
  };
}

export const ashby: SourceAdapter = {
  name: "ashby",
  async search(opts: SearchOpts): Promise<RawPosting[]> {
    const slugs = opts.companies ?? [];
    const out: RawPosting[] = [];
    for (const slug of slugs) {
      try {
        const jobs = await fetchBoard(slug);
        const limited = opts.maxPerCompany ? jobs.slice(0, opts.maxPerCompany) : jobs;
        for (const j of limited) out.push(toPosting(slug, j));
      } catch (err) {
        console.error(`[ashby] ${slug} failed:`, (err as Error).message);
      }
    }
    return out;
  },
};
