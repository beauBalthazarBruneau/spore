// MyGreenhouse cross-company job search.
//
// Unlike the per-company adapters in backend/sources/, this fetcher uses
// Greenhouse's logged-in candidate portal to search across every company
// hosted on Greenhouse — finding postings at companies we don't yet track.
//
// Auth is handled out-of-band by `.claude/agents/mygreenhouse-login.md`
// (which runs scripts/mygreenhouse-auth.ts via Playwright). That writes a
// session blob to data/mygreenhouse-session.json. This fetcher just reads
// it. When the session is dead, this stage exits with `auth_expired=true`
// so the orchestrator surfaces the need to re-auth.
//
// API shape (Inertia.js):
//   GET https://my.greenhouse.io/jobs?query=<title>&page=<n>
//   Headers: X-Inertia, X-Inertia-Version, Accept: text/html
//   Returns: { props: { jobPosts: [...], moreResultsAvailable, page } }

import type Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyHardFilters, type Criteria } from "../filters";
import { upsertJob } from "../upsert";
import type { RawPosting } from "../sources/types";

const SESSION_PATH = resolve(__dirname, "../../data/mygreenhouse-session.json");
const BASE = "https://my.greenhouse.io";
const RESULTS_PER_PAGE = 12;
const MAX_PAGES_PER_TITLE = 10; // 120 results per title is enough; deep pages are rarely fresh

interface SessionBlob {
  cookies: Array<{ name: string; value: string; domain?: string; path?: string }>;
  inertia_version: string;
  saved_at: string;
}

interface MyGreenhouseJobPost {
  id: number;
  title: string;
  companyName: string;
  logoUrl: string | null;
  publicUrl: string;
  firstPublished: string;
  locations: string[];
  workType: "in_person" | "hybrid" | "remote";
  payRanges:
    | Array<{ min?: number; max?: number; currency?: string; interval?: string }>
    | null;
  viewed: boolean;
}

interface InertiaResponse {
  component: string;
  props: {
    jobPosts?: MyGreenhouseJobPost[];
    page?: number;
    moreResultsAvailable?: boolean;
  };
  version: string;
}

export interface RunReport {
  titles_searched: string[];
  fetched: number;
  inserted: number;
  rejected: number;
  dupes: number;
  slug_resolution?: { url: number; probe: number; unknown: number };
  auth_expired?: true;
  errors: string[];
}

function loadSession(): SessionBlob | null {
  if (!existsSync(SESSION_PATH)) return null;
  try {
    return JSON.parse(readFileSync(SESSION_PATH, "utf8")) as SessionBlob;
  } catch {
    return null;
  }
}

function cookieHeader(session: SessionBlob): string {
  return session.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

async function inertiaFetch(
  session: SessionBlob,
  path: string,
  version: string,
): Promise<{ status: number; json?: InertiaResponse; redirect?: string }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      "X-Inertia": "true",
      "X-Inertia-Version": version,
      Accept: "text/html, application/xhtml+xml",
      Cookie: cookieHeader(session),
    },
    redirect: "manual",
  });
  if (res.status === 409) {
    return { status: 409, redirect: res.headers.get("x-inertia-location") ?? undefined };
  }
  if (!res.ok) return { status: res.status };
  const json = (await res.json()) as InertiaResponse;
  return { status: res.status, json };
}

/** Verifies the cached Inertia version is still current; refreshes from /dashboard if not. */
async function ensureVersion(session: SessionBlob): Promise<string | null> {
  // Try the cached version first
  const probe = await inertiaFetch(session, "/jobs?query=__probe__&page=1", session.inertia_version);
  if (probe.status === 200) return session.inertia_version;
  if (probe.status === 409) {
    // Inertia bumped the version — fetch the HTML page and parse out the new one.
    const res = await fetch(`${BASE}/jobs`, {
      headers: { Cookie: cookieHeader(session), Accept: "text/html" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(/data-page="([^"]+)"/);
    if (!match) return null;
    try {
      const decoded = match[1]
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&");
      const parsed = JSON.parse(decoded) as { version?: string; component?: string };
      // If we got redirected to a login page, component will be 'sign_in' or similar
      if (!parsed.version || parsed.component !== "job_search") return null;
      return parsed.version;
    } catch {
      return null;
    }
  }
  // 401/403/302 → session expired
  return null;
}

function workTypeToRemote(wt: MyGreenhouseJobPost["workType"]): string | undefined {
  if (wt === "remote") return "remote";
  if (wt === "hybrid") return "hybrid";
  return undefined;
}

function extractSlug(publicUrl: string): string | null {
  // job-boards.greenhouse.io/<slug>/jobs/<id> or job-boards.eu.greenhouse.io/<slug>/jobs/<id>
  const m = publicUrl.match(/job-boards(?:\.eu)?\.greenhouse\.io\/([^/]+)\/jobs\//);
  return m ? m[1] : null;
}

/** Resolves a company's Greenhouse board slug by following the canonical embed
 *  redirect. boards.greenhouse.io/embed/job_app?token=<jobId> 301s to a URL
 *  that includes `for=<slug>`. Works for postings hosted on custom domains
 *  where the slug isn't in the publicUrl. */
async function resolveSlugByJobId(jobId: string | number): Promise<string | null> {
  try {
    const res = await fetch(`https://boards.greenhouse.io/embed/job_app?token=${encodeURIComponent(String(jobId))}`, {
      redirect: "manual",
    });
    if (res.status !== 301 && res.status !== 302) return null;
    const loc = res.headers.get("location");
    if (!loc) return null;
    const m = loc.match(/[?&]for=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

function canonicalUrl(publicUrl: string): string {
  // Drop the tracking query so dedup is stable across runs.
  try {
    const u = new URL(publicUrl);
    u.search = "";
    return u.toString();
  } catch {
    return publicUrl;
  }
}

function toPosting(j: MyGreenhouseJobPost): RawPosting {
  const slug = extractSlug(j.publicUrl);
  const pay = j.payRanges?.[0];
  return {
    source: "mygreenhouse",
    source_job_id: String(j.id),
    url: canonicalUrl(j.publicUrl),
    title: j.title,
    company_name: j.companyName,
    location: j.locations.join("; ") || undefined,
    remote: workTypeToRemote(j.workType),
    salary_min: pay?.min,
    salary_max: pay?.max,
    posted_at: j.firstPublished,
    raw: { ...j, gh_slug: slug },
  };
}

async function searchTitle(
  session: SessionBlob,
  versionRef: { version: string },
  title: string,
): Promise<{ posts: MyGreenhouseJobPost[]; pages: number; authExpired: boolean }> {
  const posts: MyGreenhouseJobPost[] = [];
  for (let page = 1; page <= MAX_PAGES_PER_TITLE; page++) {
    const path = `/jobs?query=${encodeURIComponent(title)}&page=${page}`;
    let res = await inertiaFetch(session, path, versionRef.version);
    if (res.status === 409) {
      // Inertia bumped its asset version mid-run. Refresh and retry once.
      const fresh = await ensureVersion(session);
      if (!fresh) return { posts, pages: page - 1, authExpired: true };
      versionRef.version = fresh;
      res = await inertiaFetch(session, path, versionRef.version);
    }
    if (res.status !== 200 || !res.json) {
      return { posts, pages: page - 1, authExpired: true };
    }
    const batch = res.json.props.jobPosts ?? [];
    posts.push(...batch);
    if (!res.json.props.moreResultsAvailable || batch.length < RESULTS_PER_PAGE) break;
  }
  return { posts, pages: MAX_PAGES_PER_TITLE, authExpired: false };
}

export async function run(db: Database.Database): Promise<RunReport> {
  const errors: string[] = [];

  const session = loadSession();
  if (!session) {
    return {
      titles_searched: [],
      fetched: 0,
      inserted: 0,
      rejected: 0,
      dupes: 0,
      auth_expired: true,
      errors: ["no session — run /mygreenhouse-login"],
    };
  }

  const profileRow = db.prepare(`SELECT criteria_json FROM profile WHERE id = 1`).get() as
    | { criteria_json: string | null }
    | undefined;
  const criteria: Criteria = profileRow?.criteria_json ? JSON.parse(profileRow.criteria_json) : {};
  const titles = (criteria.titles ?? []).filter(Boolean);
  if (!titles.length) {
    return {
      titles_searched: [],
      fetched: 0,
      inserted: 0,
      rejected: 0,
      dupes: 0,
      errors: ["profile has no criteria.titles to search"],
    };
  }

  const version = await ensureVersion(session);
  if (!version) {
    return {
      titles_searched: [],
      fetched: 0,
      inserted: 0,
      rejected: 0,
      dupes: 0,
      auth_expired: true,
      errors: ["session expired — run /mygreenhouse-login"],
    };
  }
  const versionRef = { version };

  // Collect raw posts across all titles, dedup by id (a posting can match multiple titles).
  const byId = new Map<number, MyGreenhouseJobPost>();
  for (const title of titles) {
    const result = await searchTitle(session, versionRef, title);
    if (result.authExpired) {
      errors.push(`auth dropped mid-run on title "${title}"`);
      break;
    }
    for (const p of result.posts) byId.set(p.id, p);
  }

  const postings = [...byId.values()].map(toPosting);

  let inserted = 0;
  let rejected = 0;
  let dupes = 0;
  for (const p of postings) {
    const existing = db
      .prepare(`SELECT id FROM jobs WHERE (source=? AND source_job_id=?) OR url=? LIMIT 1`)
      .get(p.source, p.source_job_id, p.url) as { id: number } | undefined;
    if (existing) {
      dupes++;
      continue;
    }
    const filter = applyHardFilters(p, criteria);
    if (!filter.passed) {
      upsertJob(db, p, { status: "rejected", rejection_reason: filter.reason, rejected_by: "filter" });
      rejected++;
      continue;
    }
    upsertJob(db, p, { status: "fetched" });
    inserted++;
  }

  // Tag companies with their Greenhouse board info. We try the URL-embedded
  // slug first (free); for companies whose postings all live on custom
  // domains, we fall back to one HTTP probe per company via the embed
  // redirect. Existing ats_source/ats_slug are not overwritten.
  const slugCounts = { url: 0, probe: 0, unknown: 0 };

  const byCompany = new Map<string, MyGreenhouseJobPost[]>();
  for (const j of byId.values()) {
    if (!byCompany.has(j.companyName)) byCompany.set(j.companyName, []);
    byCompany.get(j.companyName)!.push(j);
  }

  // Companies surfaced by MyGreenhouse are by definition Greenhouse-hosted —
  // promote them into the watched loop so discover-jobs-by-companies picks
  // them up directly next run. ats_source/ats_slug use COALESCE so we never
  // clobber an intentional prior setting; watching is set unconditionally
  // since these companies are guaranteed-eligible (their slug just resolved).
  const updateCompany = db.prepare(
    `UPDATE companies
       SET ats_source = COALESCE(ats_source, 'greenhouse'),
           ats_slug = COALESCE(ats_slug, ?),
           watching = 1
     WHERE name = ? COLLATE NOCASE`,
  );

  for (const [companyName, posts] of byCompany) {
    let slug: string | null = null;
    for (const p of posts) {
      slug = extractSlug(p.publicUrl);
      if (slug) {
        slugCounts.url++;
        break;
      }
    }
    if (!slug) {
      slug = await resolveSlugByJobId(posts[0].id);
      if (slug) slugCounts.probe++;
      else slugCounts.unknown++;
    }
    updateCompany.run(slug, companyName);
  }

  return {
    titles_searched: titles,
    fetched: postings.length,
    inserted,
    rejected,
    dupes,
    slug_resolution: slugCounts,
    errors,
  };
}
