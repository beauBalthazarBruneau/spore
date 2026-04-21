// Tailor orchestrator stage.
// For each job in status='needs_tailoring':
//   1. Calls the Claude API with the tailor-resume agent instructions as system prompt.
//   2. Implements a tool-use loop so Claude can call start_tailoring, get_job,
//      and save_tailored against the local DB — same semantics as the MCP tools.
//   3. Logs tailoring_failed events on per-job errors; keeps job in needs_tailoring.
//   4. Logs a tailoring_run event with the full Report at the end.

import type Database from "better-sqlite3";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface Report {
  processed: number;
  succeeded: number;
  failed: number;
  duration_ms: number;
}

const AGENT_MD_PATH = resolve(__dirname, "../../.claude/agents/tailor-resume.md");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Tool implementations (mirror the MCP server's behaviour against the DB)
// ---------------------------------------------------------------------------

function toolStartTailoring(db: Database.Database, id: number): string {
  const job = db.prepare(`SELECT id, status FROM jobs WHERE id = ?`).get(id) as
    | { id: number; status: string }
    | undefined;
  if (!job) return JSON.stringify({ error: `job ${id} not found` });
  if (job.status !== "needs_tailoring") {
    return JSON.stringify({
      error: `job ${id} is in status '${job.status}', expected 'needs_tailoring'`,
    });
  }
  db.prepare(
    `UPDATE jobs SET status = 'tailoring', updated_at = datetime('now') WHERE id = ?`,
  ).run(id);
  db.prepare(
    `INSERT INTO events (entity_type, entity_id, action, actor, payload_json)
     VALUES ('job', ?, 'tailoring_started', 'claude', ?)`,
  ).run(id, JSON.stringify({ job_id: id }));
  return JSON.stringify({ ok: true });
}

function toolGetJob(db: Database.Database, id: number): string {
  const job = db
    .prepare(
      `SELECT j.*, c.name AS company_name
         FROM jobs j LEFT JOIN companies c ON c.id = j.company_id
        WHERE j.id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!job) return JSON.stringify({ error: `job ${id} not found` });
  const profile = db
    .prepare(`SELECT base_resume_md FROM profile WHERE id = 1`)
    .get() as { base_resume_md: string | null } | undefined;
  job.base_resume_md = profile?.base_resume_md ?? null;
  return JSON.stringify({ job });
}

function toolSaveTailored(
  db: Database.Database,
  id: number,
  resume_md: string,
  cover_letter_md: string,
): string {
  const job = db
    .prepare(`SELECT id FROM jobs WHERE id = ?`)
    .get(id) as { id: number } | undefined;
  if (!job) return JSON.stringify({ error: `job ${id} not found` });
  db.prepare(
    `UPDATE jobs SET resume_md = ?, cover_letter_md = ?, status = 'tailored',
      updated_at = datetime('now') WHERE id = ?`,
  ).run(resume_md, cover_letter_md, id);
  const char_count_resume = resume_md.length;
  const char_count_cover_letter = cover_letter_md.length;
  db.prepare(
    `INSERT INTO events (entity_type, entity_id, action, actor, payload_json)
     VALUES ('job', ?, 'tailoring_completed', 'claude', ?)`,
  ).run(id, JSON.stringify({ char_count_resume, char_count_cover_letter }));
  return JSON.stringify({ ok: true, char_count_resume, char_count_cover_letter });
}

// ---------------------------------------------------------------------------
// Tool definitions for the Claude API
// ---------------------------------------------------------------------------

const TOOLS: Anthropic.Tool[] = [
  {
    name: "start_tailoring",
    description:
      "Transition a job from needs_tailoring → tailoring. Returns an error if the job is not in needs_tailoring status.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Job id" },
      },
      required: ["id"],
    },
  },
  {
    name: "get_job",
    description:
      "Return a single job row joined with company_name and the user's base_resume_md from profile.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Job id" },
      },
      required: ["id"],
    },
  },
  {
    name: "save_tailored",
    description:
      "Write resume_md and cover_letter_md to the job row and advance status to 'tailored'.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Job id" },
        resume_md: { type: "string", description: "Tailored resume as markdown" },
        cover_letter_md: { type: "string", description: "Cover letter as markdown" },
      },
      required: ["id", "resume_md", "cover_letter_md"],
    },
  },
];

// ---------------------------------------------------------------------------
// Per-job agent invocation
// ---------------------------------------------------------------------------

async function tailorJob(
  db: Database.Database,
  claude: Anthropic,
  systemPrompt: string,
  jobId: number,
): Promise<void> {
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Process job id=${jobId}. Call start_tailoring(${jobId}), then get_job(${jobId}), produce the tailored resume and cover letter, and call save_tailored to save them.`,
    },
  ];

  // Agentic tool-use loop
  while (true) {
    const response = await claude.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 16000,
      system: systemPrompt,
      tools: TOOLS,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      break;
    }

    if (response.stop_reason !== "tool_use") {
      break;
    }

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tool of toolUseBlocks) {
      let result: string;
      try {
        const input = tool.input as Record<string, unknown>;
        if (tool.name === "start_tailoring") {
          result = toolStartTailoring(db, input.id as number);
        } else if (tool.name === "get_job") {
          result = toolGetJob(db, input.id as number);
        } else if (tool.name === "save_tailored") {
          result = toolSaveTailored(
            db,
            input.id as number,
            input.resume_md as string,
            input.cover_letter_md as string,
          );
        } else {
          result = JSON.stringify({ error: `unknown tool: ${tool.name}` });
        }
      } catch (err) {
        result = JSON.stringify({ error: (err as Error).message });
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: tool.id,
        content: result,
      });
    }

    messages.push({ role: "user", content: toolResults });
  }
}

// ---------------------------------------------------------------------------
// run()
// ---------------------------------------------------------------------------

export async function run(
  db: Database.Database,
  extra: Record<string, string> = {},
  /** Optional pre-built client — used in tests to inject a mock. */
  _claude?: Anthropic,
): Promise<Report> {
  const limit = extra.limit ? parseInt(extra.limit, 10) : 10;

  const jobs = db
    .prepare(
      `SELECT id, title FROM jobs WHERE status = 'needs_tailoring' ORDER BY id ASC LIMIT ?`,
    )
    .all(limit) as Array<{ id: number; title: string }>;

  const systemPrompt = readFileSync(AGENT_MD_PATH, "utf8");
  const claude = _claude ?? new Anthropic();

  let succeeded = 0;
  let failed = 0;
  const startTime = Date.now();

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const jobStart = Date.now();

    try {
      console.log(`[tailor] processing job ${job.id}: ${job.title}`);
      await tailorJob(db, claude, systemPrompt, job.id);

      // Verify the job actually advanced to tailored
      const updated = db
        .prepare(`SELECT status FROM jobs WHERE id = ?`)
        .get(job.id) as { status: string } | undefined;

      if (updated?.status === "tailored") {
        succeeded++;
        const duration = Date.now() - jobStart;
        console.log(`[tailor] job ${job.id} succeeded in ${duration}ms`);
      } else {
        throw new Error(
          `job ${job.id} did not advance to 'tailored' (status=${updated?.status})`,
        );
      }
    } catch (err) {
      failed++;
      const errorMessage = (err as Error).message;
      console.error(`[tailor] job ${job.id} failed: ${errorMessage}`);
      db.prepare(
        `INSERT INTO events (entity_type, entity_id, action, actor, payload_json)
         VALUES ('job', ?, 'tailoring_failed', 'system', ?)`,
      ).run(job.id, JSON.stringify({ job_id: job.id, error_message: errorMessage }));
    }

    // 1-second delay between jobs (except after the last one)
    if (i < jobs.length - 1) {
      await sleep(1000);
    }
  }

  const duration_ms = Date.now() - startTime;
  const report: Report = {
    processed: jobs.length,
    succeeded,
    failed,
    duration_ms,
  };

  db.prepare(
    `INSERT INTO events (entity_type, entity_id, action, actor, payload_json)
     VALUES ('system', 0, 'tailoring_run', 'system', ?)`,
  ).run(JSON.stringify(report));

  return report;
}
