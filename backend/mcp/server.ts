// Spore MCP server. Single channel agents use to talk to the SQLite db.
//
// Tools:
//   upsert_company    — create/update a company (name + optional ATS info, watching, notes)
//   probe_ats         — verify a (source, slug) pair returns jobs without writing
//   get_profile       — read profile (criteria, base_resume_md, etc.) for the find-jobs agent
//   upsert_profile    — create or update profile fields (partial updates via COALESCE)
//   fetch_candidates  — run the find-jobs fetch+hard-filter+insert pipeline, return candidates
//   upsert_scored     — promote/demote candidates after the agent has scored them
//
// Run via: npx tsx backend/mcp/server.ts (registered in .mcp.json)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "../db";
import { sources } from "../sources";
import { upsertJob } from "../upsert";
import type { RawPosting } from "../sources/types";
import { renderJobPdfs } from "../pdf";

const SUPPORTED_ATS = ["greenhouse", "lever", "ashby", "rippling"] as const;
const ATS_SOURCE = z.enum(SUPPORTED_ATS);
/** Accepts any ATS name for storage — only supported ones can be probed/watched. */
const ATS_SOURCE_ANY = z.string();

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
      ats_source: ATS_SOURCE_ANY.nullish().describe("ATS name (any string accepted for storage; only greenhouse/lever/ashby/rippling can be probed/watched)"),
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

    if (watching && args.ats_source && !sources[args.ats_source]) {
      warning = `ats_source '${args.ats_source}' is not a supported adapter — forcing watching=0`;
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

// ---------- Profile ----------

server.registerTool(
  "get_profile",
  {
    description:
      "Read the user profile, including parsed criteria_json, preferences_json, links_json, and the base_resume_md. Returns null if no profile is set.",
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

server.registerTool(
  "upsert_profile",
  {
    description:
      "Create or update the user profile (singleton row, id=1). All fields use COALESCE so you can send a partial update without clobbering unset fields. JSON fields (links, preferences, criteria) accept objects — they are stringified before storage.",
    inputSchema: {
      full_name: z.string().nullish(),
      email: z.string().nullish(),
      phone: z.string().nullish(),
      location: z.string().nullish(),
      links_json: z
        .object({
          linkedin: z.string().optional(),
          github: z.string().optional(),
          portfolio: z.string().optional(),
        })
        .passthrough()
        .nullish()
        .describe("Links object — keys are label, values are URLs"),
      base_resume_md: z.string().nullish().describe("Base resume content as markdown"),
      preferences_json: z
        .object({ remote_ok: z.boolean().optional() })
        .passthrough()
        .nullish()
        .describe("Freeform preferences object"),
      criteria_json: z
        .object({
          titles: z.array(z.string()).optional(),
          locations: z.array(z.string()).optional(),
          keywords: z.array(z.string()).optional(),
          exclusions: z
            .object({
              companies: z.array(z.string()).optional(),
              company_domains: z.array(z.string()).optional(),
              title_keywords: z.array(z.string()).optional(),
              description_keywords: z.array(z.string()).optional(),
              industries: z.array(z.string()).optional(),
              locations: z.array(z.string()).optional(),
              seniority: z.array(z.string()).optional(),
              visa_required: z.boolean().optional(),
            })
            .passthrough()
            .optional(),
          salary_min: z.number().optional(),
          remote_pref: z.string().optional(),
        })
        .passthrough()
        .nullish()
        .describe("Job search criteria"),
    },
  },
  async (args) => {
    const db = getDb();
    const exists = !!db.prepare(`SELECT 1 FROM profile WHERE id = 1`).get();

    if (!exists) {
      db.prepare(
        `INSERT INTO profile (id, full_name, email, phone, location, links_json, base_resume_md, preferences_json, criteria_json)
         VALUES (1, @full_name, @email, @phone, @location, @links_json, @base_resume_md, @preferences_json, @criteria_json)`,
      ).run({
        full_name: args.full_name ?? null,
        email: args.email ?? null,
        phone: args.phone ?? null,
        location: args.location ?? null,
        links_json: args.links_json ? JSON.stringify(args.links_json) : null,
        base_resume_md: args.base_resume_md ?? null,
        preferences_json: args.preferences_json ? JSON.stringify(args.preferences_json) : null,
        criteria_json: args.criteria_json ? JSON.stringify(args.criteria_json) : null,
      });
    } else {
      db.prepare(
        `UPDATE profile SET
           full_name = COALESCE(@full_name, full_name),
           email = COALESCE(@email, email),
           phone = COALESCE(@phone, phone),
           location = COALESCE(@location, location),
           links_json = COALESCE(@links_json, links_json),
           base_resume_md = COALESCE(@base_resume_md, base_resume_md),
           preferences_json = COALESCE(@preferences_json, preferences_json),
           criteria_json = COALESCE(@criteria_json, criteria_json),
           updated_at = datetime('now')
         WHERE id = 1`,
      ).run({
        full_name: args.full_name ?? null,
        email: args.email ?? null,
        phone: args.phone ?? null,
        location: args.location ?? null,
        links_json: args.links_json ? JSON.stringify(args.links_json) : null,
        base_resume_md: args.base_resume_md ?? null,
        preferences_json: args.preferences_json ? JSON.stringify(args.preferences_json) : null,
        criteria_json: args.criteria_json ? JSON.stringify(args.criteria_json) : null,
      });
    }

    const row = db.prepare(`SELECT * FROM profile WHERE id = 1`).get() as Record<string, unknown> & {
      links_json?: string | null;
      preferences_json?: string | null;
      criteria_json?: string | null;
    };
    return ok({
      action: exists ? "updated" : "created",
      profile: {
        ...row,
        links_json: row.links_json ? JSON.parse(row.links_json) : {},
        preferences_json: row.preferences_json ? JSON.parse(row.preferences_json) : {},
        criteria_json: row.criteria_json ? JSON.parse(row.criteria_json) : {},
      },
    });
  },
);

// ---------- Scoring queue ----------
// Fetching is now handled by scripts/orchestrate.ts + backend/fetchers/*. The
// scoring agent picks up work via list_jobs({ status: 'fetched' }) and writes
// results via upsert_scored (id-based update).

server.registerTool(
  "list_jobs",
  {
    description:
      "List jobs from the DB with a flat { id, title, company_name, url, location, description, ... } shape. Filter by status (commonly 'fetched' for the scoring queue). Ordered by discovered_at DESC. Omit status to list all.",
    inputSchema: {
      status: z.string().optional().describe("e.g. 'fetched', 'new', 'rejected'"),
      limit: z.number().int().positive().optional(),
    },
  },
  async (args) => {
    const db = getDb();
    const limitClause = args.limit ? `LIMIT ${args.limit}` : "";
    const select = `
      SELECT j.id, j.title, c.name AS company_name, j.url, j.source, j.source_job_id,
             j.location, j.remote, j.salary_min, j.salary_max, j.salary_range,
             j.posted_at, j.description, j.prescore, j.score, j.match_explanation, j.status
        FROM jobs j LEFT JOIN companies c ON c.id = j.company_id
    `;
    const rows = args.status
      ? db
          .prepare(`${select} WHERE j.status = ? ORDER BY j.discovered_at DESC ${limitClause}`)
          .all(args.status)
      : db.prepare(`${select} ORDER BY j.discovered_at DESC ${limitClause}`).all();
    return ok({ count: rows.length, jobs: rows });
  },
);

server.registerTool(
  "upsert_scored",
  {
    description:
      "Update-by-id: promote/demote jobs after scoring. score >= threshold sets status='new' (ready for Swipe); below sets status='rejected' with decline_reason (falls back to 'score N < threshold'). Logs a score_jobs_run event. Operates on existing rows — does not insert.",
    inputSchema: {
      threshold: z.number().int().optional().describe("Default 60"),
      items: z
        .array(
          z.object({
            id: z.number().int(),
            score: z.number(),
            match_explanation: z.string().optional(),
            decline_reason: z.string().optional(),
          }),
        )
        .describe("One entry per job id returned by list_jobs"),
    },
  },
  async (args) => {
    const db = getDb();
    const threshold = args.threshold ?? 60;
    const update = db.prepare(
      `UPDATE jobs SET status = ?, score = ?, match_explanation = ?, rejection_reason = ?, rejected_by = ? WHERE id = ?`,
    );
    let promoted = 0;
    let declined = 0;
    const not_found: number[] = [];
    for (const s of args.items) {
      const status = s.score >= threshold ? "new" : "rejected";
      const rejection_reason =
        status === "rejected" ? s.decline_reason ?? `score ${s.score} < ${threshold}` : null;
      const rejected_by = status === "rejected" ? "agent" : null;
      const info = update.run(status, s.score, s.match_explanation ?? null, rejection_reason, rejected_by, s.id);
      if (info.changes === 0) {
        not_found.push(s.id);
        continue;
      }
      if (status === "new") promoted++;
      else declined++;
    }
    db.prepare(
      `INSERT INTO events (entity_type, entity_id, action, actor, payload_json) VALUES (?,?,?,?,?)`,
    ).run(
      "system",
      0,
      "score_jobs_run",
      "claude",
      JSON.stringify({ total: args.items.length, promoted, declined, threshold, not_found: not_found.length }),
    );
    return ok({ total: args.items.length, promoted, declined, threshold, not_found });
  },
);

// ---------- Manual job add (bypasses the find-jobs scoring loop) ----------

server.registerTool(
  "add_jobs",
  {
    description:
      "Insert one or more job postings the user is manually adding (from URLs, screenshots, or pasted role descriptions). Auto-creates the company by name (case-insensitive) if it doesn't exist — the new company row has no ATS info and watching=0. Dedup is on (source, source_job_id) OR url, so the same URL pasted twice is a no-op. Default status is 'new' (lands in the Swipe queue).",
    inputSchema: {
      status: z
        .enum(["new", "approved", "fetched", "needs_tailoring"])
        .optional()
        .describe("Default 'new' (Swipe queue). 'approved' auto-promotes to 'needs_tailoring' on the Board."),
      items: z.array(
        z.object({
          title: z.string(),
          company_name: z.string(),
          url: z.string().describe("Required — used as the dedup key when source_job_id is absent"),
          source: z
            .string()
            .optional()
            .describe(
              "Default 'manual'. Use 'greenhouse'|'lever'|'ashby'|'rippling' if the URL is from a known ATS so future fetch_candidates runs dedup against the same job.",
            ),
          source_job_id: z.string().optional().describe("Falls back to url if not provided"),
          description: z.string().optional(),
          location: z.string().optional(),
          remote: z.string().optional(),
          salary_min: z.number().optional(),
          salary_max: z.number().optional(),
          salary_range: z.string().optional(),
          posted_at: z.string().optional(),
          company_domain: z.string().optional(),
        }),
      ),
    },
  },
  async (args) => {
    const db = getDb();
    const status = args.status ?? "new";
    let inserted = 0;
    let skipped = 0;
    const results: Array<{
      title: string;
      company: string;
      id: number;
      inserted: boolean;
      new_company: boolean;
      skip_reason?: string;
    }> = [];

    for (const item of args.items) {
      const companyExisted = !!db
        .prepare(`SELECT 1 FROM companies WHERE name = ? COLLATE NOCASE`)
        .get(item.company_name);

      const posting: RawPosting = {
        source: item.source ?? "manual",
        source_job_id: item.source_job_id ?? item.url,
        url: item.url,
        title: item.title,
        company_name: item.company_name,
        company_domain: item.company_domain,
        location: item.location,
        remote: item.remote,
        salary_min: item.salary_min,
        salary_max: item.salary_max,
        salary_range: item.salary_range,
        posted_at: item.posted_at,
        description: item.description,
        raw: item,
      };

      const result = upsertJob(db, posting, { status });
      results.push({
        title: item.title,
        company: item.company_name,
        id: result.id,
        inserted: result.inserted,
        new_company: result.inserted && !companyExisted,
        skip_reason: result.inserted ? undefined : "duplicate",
      });
      if (result.inserted) inserted++;
      else skipped++;
    }

    return ok({ inserted, skipped, status, results });
  },
);

// ---------- Tailoring ----------

server.registerTool(
  "get_job",
  {
    description:
      "Return a single job row joined with company_name and the user's base_resume_md from profile (id=1). This is the tailoring agent's single read call — job description, all existing fields, and the base resume in one shot.",
    inputSchema: {
      id: z.number().int().describe("Job id"),
    },
  },
  async (args) => {
    const db = getDb();
    const job = db
      .prepare(
        `SELECT j.*, c.name AS company_name
           FROM jobs j LEFT JOIN companies c ON c.id = j.company_id
          WHERE j.id = ?`,
      )
      .get(args.id) as Record<string, unknown> | undefined;
    if (!job) return err(`job ${args.id} not found`);
    const profile = db.prepare(`SELECT base_resume_md FROM profile WHERE id = 1`).get() as
      | { base_resume_md: string | null }
      | undefined;
    job.base_resume_md = profile?.base_resume_md ?? null;
    return ok({ job });
  },
);

server.registerTool(
  "start_tailoring",
  {
    description:
      "Transition a job from needs_tailoring → tailoring. Returns an error if the job is not in needs_tailoring status. Logs a tailoring_started event.",
    inputSchema: {
      id: z.number().int().describe("Job id"),
    },
  },
  async (args) => {
    const db = getDb();
    const job = db.prepare(`SELECT id, status FROM jobs WHERE id = ?`).get(args.id) as
      | { id: number; status: string }
      | undefined;
    if (!job) return err(`job ${args.id} not found`);
    if (job.status !== "needs_tailoring") {
      return err(`job ${args.id} is in status '${job.status}', expected 'needs_tailoring'`);
    }
    db.prepare(`UPDATE jobs SET status = 'tailoring', updated_at = datetime('now') WHERE id = ?`).run(args.id);
    db.prepare(
      `INSERT INTO events (entity_type, entity_id, action, actor, payload_json) VALUES ('job', ?, 'tailoring_started', 'claude', ?)`,
    ).run(args.id, JSON.stringify({ job_id: args.id }));
    return ok({ ok: true });
  },
);

server.registerTool(
  "save_tailored",
  {
    description:
      "Write resume_md and cover_letter_md to the job row and advance status to 'tailored'. Logs a tailoring_completed event with character counts.",
    inputSchema: {
      id: z.number().int().describe("Job id"),
      resume_md: z.string().describe("Tailored resume as markdown"),
      cover_letter_md: z.string().describe("Cover letter as markdown"),
    },
  },
  async (args) => {
    const db = getDb();
    const job = db.prepare(`SELECT id FROM jobs WHERE id = ?`).get(args.id) as { id: number } | undefined;
    if (!job) return err(`job ${args.id} not found`);
    db.prepare(
      `UPDATE jobs SET resume_md = ?, cover_letter_md = ?, status = 'tailored', updated_at = datetime('now') WHERE id = ?`,
    ).run(args.resume_md, args.cover_letter_md, args.id);
    const char_count_resume = args.resume_md.length;
    const char_count_cover_letter = args.cover_letter_md.length;
    db.prepare(
      `INSERT INTO events (entity_type, entity_id, action, actor, payload_json) VALUES ('job', ?, 'tailoring_completed', 'claude', ?)`,
    ).run(args.id, JSON.stringify({ char_count_resume, char_count_cover_letter }));
    return ok({ ok: true, char_count_resume, char_count_cover_letter });
  },
);

// ---------- PDF rendering ----------

server.registerTool(
  "render_pdf",
  {
    description:
      "Render the tailored resume and cover letter for a job to PDF. Reads resume_md and cover_letter_md from the job row, renders both to PDF, stores the BLOBs in resume_pdf/cover_letter_pdf, and logs a pdf_rendered event. Returns byte counts.",
    inputSchema: {
      job_id: z.number().int().describe("Job id"),
    },
  },
  async (args) => {
    const db = getDb();
    try {
      const result = await renderJobPdfs(db, args.job_id);
      return ok(result);
    } catch (e) {
      return err((e as Error).message);
    }
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
