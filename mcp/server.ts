// Spore MCP server. Single channel agents use to talk to the SQLite db.
//
// Tools:
//   upsert_company    — create/update a company (name + optional ATS info, watching, notes)
//   probe_ats         — verify a (source, slug) pair returns jobs without writing
//   get_profile       — read profile (criteria, base_resume_path, etc.) for the find-jobs agent
//   fetch_candidates  — run the find-jobs fetch+hard-filter+insert pipeline, return candidates
//   upsert_scored     — promote/demote candidates after the agent has scored them
//
// Run via: npx tsx mcp/server.ts (registered in .mcp.json)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "./db";
import { sources } from "./sources";
import { upsertJob, upsertScoredJob } from "./upsert";
import { applyHardFilters, type Criteria } from "./filters";
import type { RawPosting } from "./sources/types";

const ATS_SOURCE = z.enum(["greenhouse", "lever", "ashby", "rippling"]);

const RAW_POSTING_SCHEMA = z.object({
  source: z.string(),
  source_job_id: z.string(),
  url: z.string(),
  title: z.string(),
  company_name: z.string(),
  company_domain: z.string().optional(),
  location: z.string().optional(),
  remote: z.string().optional(),
  salary_min: z.number().optional(),
  salary_max: z.number().optional(),
  salary_range: z.string().optional(),
  posted_at: z.string().optional(),
  description: z.string().optional(),
  raw: z.unknown().optional(),
});

function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  };
}

function err(message: string) {
  return {
    content: [{ type: "text" as const, text: `error: ${message}` }],
    isError: true,
  };
}

const server = new McpServer({ name: "spore", version: "0.1.0" });

// ---------- Companies ----------

server.registerTool(
  "upsert_company",
  {
    description:
      "Create or update a company by name (case-insensitive). If watching=true is requested with an ats_source/ats_slug, the slug is probed first via the matching source adapter; if the probe fails, watching is forced to false and a warning is included in the response.",
    inputSchema: {
      name: z.string().describe("Company name (case-insensitive unique key)"),
      ats_source: ATS_SOURCE.nullish(),
      ats_slug: z.string().nullish().describe("Board identifier on the ATS"),
      watching: z.boolean().optional().describe("Include in scheduled find-jobs fetches"),
      domain: z.string().nullish(),
      linkedin_url: z.string().nullish(),
      notes: z.string().nullish(),
      skip_probe: z.boolean().optional().describe("Skip the ATS reachability probe"),
    },
  },
  async (args) => {
    const db = getDb();
    let watching = args.watching ? 1 : 0;
    let warning: string | undefined;

    if (watching && (!args.ats_source || !args.ats_slug)) {
      warning = "watching requested but ats_source/ats_slug missing — forcing watching=0";
      watching = 0;
    }

    if (!args.skip_probe && watching && args.ats_source && args.ats_slug) {
      const adapter = sources[args.ats_source];
      try {
        const postings = await adapter.search({ companies: [args.ats_slug], maxPerCompany: 1 });
        if (postings.length === 0) {
          warning = `ATS probe returned 0 postings — forcing watching=0`;
          watching = 0;
        }
      } catch (e) {
        warning = `ATS probe failed (${(e as Error).message}) — forcing watching=0`;
        watching = 0;
      }
    }

    const existed = !!db
      .prepare(`SELECT 1 FROM companies WHERE name = ? COLLATE NOCASE`)
      .get(args.name);

    db.prepare(
      `INSERT INTO companies (name, ats_source, ats_slug, watching, domain, linkedin_url, notes)
       VALUES (@name, @ats_source, @ats_slug, @watching, @domain, @linkedin_url, @notes)
       ON CONFLICT(name) DO UPDATE SET
         ats_source = COALESCE(excluded.ats_source, companies.ats_source),
         ats_slug = COALESCE(excluded.ats_slug, companies.ats_slug),
         watching = COALESCE(excluded.watching, companies.watching),
         domain = COALESCE(excluded.domain, companies.domain),
         linkedin_url = COALESCE(excluded.linkedin_url, companies.linkedin_url),
         notes = COALESCE(excluded.notes, companies.notes),
         archived = 0`,
    ).run({
      name: args.name.trim(),
      ats_source: args.ats_source ?? null,
      ats_slug: args.ats_slug ?? null,
      watching,
      domain: args.domain ?? null,
      linkedin_url: args.linkedin_url ?? null,
      notes: args.notes ?? null,
    });

    const row = db
      .prepare(
        `SELECT id, name, ats_source, ats_slug, watching, archived, domain, linkedin_url, notes
           FROM companies WHERE name = ? COLLATE NOCASE`,
      )
      .get(args.name) as Record<string, unknown>;
    return ok({ action: existed ? "updated" : "added", company: row, warning });
  },
);

server.registerTool(
  "probe_ats",
  {
    description:
      "Probe an ATS board to check that (source, slug) returns postings. Read-only — no DB writes. Returns count + a few sample titles.",
    inputSchema: {
      ats_source: ATS_SOURCE,
      ats_slug: z.string(),
    },
  },
  async (args) => {
    const adapter = sources[args.ats_source];
    if (!adapter) return err(`unknown ats_source: ${args.ats_source}`);
    try {
      const postings = await adapter.search({ companies: [args.ats_slug], maxPerCompany: 5 });
      return ok({
        ok: postings.length > 0,
        count: postings.length,
        sample: postings.slice(0, 3).map((p) => ({ title: p.title, location: p.location, url: p.url })),
      });
    } catch (e) {
      return ok({ ok: false, count: 0, error: (e as Error).message });
    }
  },
);

// ---------- Profile (read-only — find-jobs agent needs criteria) ----------

server.registerTool(
  "get_profile",
  {
    description:
      "Read the user profile, including parsed criteria_json, preferences_json, links_json, and the base_resume_path. Returns null if no profile is set.",
    inputSchema: {},
  },
  async () => {
    const row = getDb().prepare(`SELECT * FROM profile WHERE id = 1`).get() as
      | (Record<string, unknown> & {
          links_json?: string | null;
          preferences_json?: string | null;
          criteria_json?: string | null;
        })
      | undefined;
    if (!row) return ok(null);
    return ok({
      ...row,
      links_json: row.links_json ? JSON.parse(row.links_json) : {},
      preferences_json: row.preferences_json ? JSON.parse(row.preferences_json) : {},
      criteria_json: row.criteria_json ? JSON.parse(row.criteria_json) : {},
    });
  },
);

// ---------- Find-jobs pipeline ----------

server.registerTool(
  "fetch_candidates",
  {
    description:
      "Fetch postings from every watching=1 company, dedup against existing rows, apply hard exclusions from profile.criteria_json, and insert survivors with status='fetched'. Returns the candidate array (RawPosting[]) for the agent to score.",
    inputSchema: {
      limit: z.number().int().positive().optional().describe("Cap on candidates returned (after dedup + filters)"),
    },
  },
  async (args) => {
    const db = getDb();
    const profileRow = db.prepare(`SELECT criteria_json FROM profile WHERE id = 1`).get() as
      | { criteria_json: string | null }
      | undefined;
    const criteria: Criteria = profileRow?.criteria_json ? JSON.parse(profileRow.criteria_json) : {};

    const watched = db
      .prepare(
        `SELECT name, ats_source, ats_slug FROM companies
          WHERE watching = 1 AND ats_source IS NOT NULL AND ats_slug IS NOT NULL`,
      )
      .all() as Array<{ name: string; ats_source: string; ats_slug: string }>;

    const bySource = new Map<string, string[]>();
    for (const c of watched) {
      const arr = bySource.get(c.ats_source) ?? [];
      arr.push(c.ats_slug);
      bySource.set(c.ats_source, arr);
    }

    const raw: RawPosting[] = [];
    const fetchErrors: Array<{ source: string; error: string }> = [];
    for (const [source, slugs] of bySource) {
      const adapter = sources[source];
      if (!adapter) {
        fetchErrors.push({ source, error: "unknown ats_source" });
        continue;
      }
      try {
        raw.push(...(await adapter.search({ companies: slugs })));
      } catch (e) {
        fetchErrors.push({ source, error: (e as Error).message });
      }
    }

    const slugToName = new Map<string, string>();
    for (const c of watched) slugToName.set(`${c.ats_source}:${c.ats_slug}`, c.name);
    for (const p of raw) {
      const canonical = slugToName.get(`${p.source}:${p.company_name}`);
      if (canonical) p.company_name = canonical;
    }

    const limit = args.limit ?? Infinity;
    const candidates: RawPosting[] = [];
    let rejected = 0;
    let dupes = 0;

    for (const p of raw) {
      const existing = db
        .prepare(`SELECT id, status FROM jobs WHERE (source=? AND source_job_id=?) OR url=? LIMIT 1`)
        .get(p.source, p.source_job_id, p.url) as { id: number; status: string } | undefined;
      if (existing) {
        if (existing.status === "fetched") {
          candidates.push(p);
          if (candidates.length >= limit) break;
        } else {
          dupes++;
        }
        continue;
      }
      const filter = applyHardFilters(p, criteria);
      if (!filter.passed) {
        upsertJob(db, p, { status: "rejected", rejection_reason: filter.reason });
        rejected++;
        continue;
      }
      upsertJob(db, p, { status: "fetched" });
      candidates.push(p);
      if (candidates.length >= limit) break;
    }

    return ok({
      fetched: raw.length,
      dupes,
      rejected,
      candidates_count: candidates.length,
      fetch_errors: fetchErrors,
      candidates,
    });
  },
);

server.registerTool(
  "upsert_scored",
  {
    description:
      "Promote/demote candidates after scoring. score >= threshold becomes status='new' (ready for Swipe); below becomes status='rejected'. Logs a find_jobs_run event.",
    inputSchema: {
      threshold: z.number().int().optional().describe("Default 60"),
      items: z
        .array(
          RAW_POSTING_SCHEMA.extend({
            score: z.number(),
            match_explanation: z.string().optional(),
            decline_reason: z.string().optional(),
          }),
        )
        .describe("Scored postings — same shape returned by fetch_candidates plus score/match_explanation/decline_reason"),
    },
  },
  async (args) => {
    const db = getDb();
    const threshold = args.threshold ?? 60;
    let promoted = 0;
    let declined = 0;
    for (const s of args.items) {
      const status = s.score >= threshold ? "new" : "rejected";
      const posting = { ...s, raw: s.raw ?? {} } as RawPosting;
      upsertScoredJob(db, posting, {
        status,
        score: s.score,
        match_explanation: s.match_explanation,
        rejection_reason:
          status === "rejected" ? s.decline_reason ?? `score ${s.score} < ${threshold}` : undefined,
      });
      if (status === "new") promoted++;
      else declined++;
    }
    db.prepare(
      `INSERT INTO events (entity_type, entity_id, action, actor, payload_json) VALUES (?,?,?,?,?)`,
    ).run(
      "system",
      0,
      "find_jobs_run",
      "claude",
      JSON.stringify({ total: args.items.length, inserted: promoted, skipped: declined, threshold }),
    );
    return ok({ total: args.items.length, inserted: promoted, skipped: declined, threshold });
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
