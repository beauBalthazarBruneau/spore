import type { RawPosting, SearchOpts, SourceAdapter } from "./types";

// Lever: https://api.lever.co/v0/postings/{company}?mode=json
interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl?: string;
  createdAt?: number;
  categories?: { location?: string; commitment?: string; team?: string; department?: string };
  descriptionPlain?: string;
  description?: string;
  lists?: Array<{ text: string; content: string }>;
}

async function fetchBoard(slug: string): Promise<LeverJob[]> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`lever ${slug}: ${res.status}`);
  return (await res.json()) as LeverJob[];
}

function stripHtml(s: string | undefined): string | undefined {
  if (!s) return undefined;
  return s.replace(/<[^>]+>/g, "").replace(/\s+\n/g, "\n").trim();
}

function toPosting(slug: string, j: LeverJob): RawPosting {
  const listText = (j.lists ?? [])
    .map((l) => `${l.text}\n${stripHtml(l.content) ?? ""}`)
    .join("\n\n");
  const description = [j.descriptionPlain ?? stripHtml(j.description), listText]
    .filter(Boolean)
    .join("\n\n");
  return {
    source: "lever",
    source_job_id: j.id,
    url: j.hostedUrl,
    title: j.text,
    company_name: slug,
    location: j.categories?.location,
    remote: j.categories?.commitment,
    posted_at: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
    description,
    raw: j,
  };
}

export const lever: SourceAdapter = {
  name: "lever",
  async search(opts: SearchOpts): Promise<RawPosting[]> {
    const slugs = opts.companies ?? [];
    const out: RawPosting[] = [];
    for (const slug of slugs) {
      try {
        const jobs = await fetchBoard(slug);
        const limited = opts.maxPerCompany ? jobs.slice(0, opts.maxPerCompany) : jobs;
        for (const j of limited) out.push(toPosting(slug, j));
      } catch (err) {
        console.error(`[lever] ${slug} failed:`, (err as Error).message);
      }
    }
    return out;
  },
};
