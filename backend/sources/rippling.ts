import type { RawPosting, SearchOpts, SourceAdapter } from "./types";

// Rippling exposes an unauthenticated per-company endpoint used by their hosted
// career pages:
//   list:   https://ats.rippling.com/api/v2/board/{slug}/jobs?page=N&pageSize=M
//   detail: https://ats.rippling.com/api/v2/board/{slug}/jobs/{id}
// The list response is paginated and excludes descriptions, so we fetch detail
// per job (in parallel) to populate them.

interface RipplingLocation {
  name?: string;
  country?: string | null;
  state?: string | null;
  city?: string | null;
  workplaceType?: string | null; // REMOTE | HYBRID | ON_SITE
}

interface RipplingListItem {
  id: string;
  name: string;
  url: string;
  department?: { name?: string };
  locations?: RipplingLocation[];
  language?: string;
}

interface RipplingListResponse {
  items?: RipplingListItem[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

interface RipplingDetail {
  uuid: string;
  name: string;
  description?: { company?: string; role?: string };
  workLocations?: string[];
  department?: { name?: string };
  employmentType?: { id?: string; label?: string };
  createdOn?: string;
}

const PAGE_SIZE = 100;

async function fetchAllListItems(slug: string): Promise<RipplingListItem[]> {
  const items: RipplingListItem[] = [];
  let page = 0;
  for (;;) {
    const url = `https://ats.rippling.com/api/v2/board/${encodeURIComponent(slug)}/jobs?page=${page}&pageSize=${PAGE_SIZE}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`rippling ${slug}: ${res.status}`);
    const body = (await res.json()) as RipplingListResponse;
    items.push(...(body.items ?? []));
    if (page + 1 >= body.totalPages) break;
    page++;
  }
  return items;
}

async function fetchDetail(slug: string, id: string): Promise<RipplingDetail | null> {
  const url = `https://ats.rippling.com/api/v2/board/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(id)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return (await res.json()) as RipplingDetail;
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

function joinDescription(d: RipplingDetail["description"]): string | undefined {
  if (!d) return undefined;
  return [stripHtml(d.role), stripHtml(d.company)].filter(Boolean).join("\n\n") || undefined;
}

function pickLocation(item: RipplingListItem): { location?: string; remote?: string } {
  const loc = item.locations?.[0];
  if (!loc) return {};
  const workplace = loc.workplaceType?.toLowerCase().replace("_", "");
  const remote =
    workplace === "remote" ? "remote" : workplace === "hybrid" ? "hybrid" : workplace === "onsite" ? "onsite" : undefined;
  const parts = [loc.city, loc.state, loc.country].filter(Boolean);
  const location = loc.name ?? (parts.length ? parts.join(", ") : undefined);
  return { location, remote };
}

function toPosting(slug: string, item: RipplingListItem, detail: RipplingDetail | null): RawPosting {
  const { location, remote } = pickLocation(item);
  return {
    source: "rippling",
    source_job_id: item.id,
    url: item.url,
    title: item.name,
    company_name: slug,
    location,
    remote,
    posted_at: detail?.createdOn,
    description: detail ? joinDescription(detail.description) : undefined,
    raw: { item, detail },
  };
}

export const rippling: SourceAdapter = {
  name: "rippling",
  async search(opts: SearchOpts): Promise<RawPosting[]> {
    const slugs = opts.companies ?? [];
    const out: RawPosting[] = [];
    for (const slug of slugs) {
      try {
        const items = await fetchAllListItems(slug);
        const limited = opts.maxPerCompany ? items.slice(0, opts.maxPerCompany) : items;
        const details = await Promise.all(limited.map((it) => fetchDetail(slug, it.id).catch(() => null)));
        for (let i = 0; i < limited.length; i++) out.push(toPosting(slug, limited[i], details[i]));
      } catch (err) {
        console.error(`[rippling] ${slug} failed:`, (err as Error).message);
      }
    }
    return out;
  },
};
