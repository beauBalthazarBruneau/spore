import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------
// Import the functions-under-test directly (not the default export) so we can
// inject a mock Claude client without fighting module caching.
// ---------------------------------------------------------------------------
import { run } from "./tailor";

// ---------------------------------------------------------------------------
// DB setup
// ---------------------------------------------------------------------------

let _urlCounter = 0;

function setupDb(): Database.Database {
  const db = new Database(":memory:");
  const schema = readFileSync(resolve(__dirname, "../schema.sql"), "utf8");
  db.exec(schema);

  const companyCols = db.prepare(`PRAGMA table_info(companies)`).all() as Array<{ name: string }>;
  const companyNames = new Set(companyCols.map((c) => c.name));
  if (!companyNames.has("ats_source")) db.exec(`ALTER TABLE companies ADD COLUMN ats_source TEXT`);
  if (!companyNames.has("ats_slug")) db.exec(`ALTER TABLE companies ADD COLUMN ats_slug TEXT`);
  if (!companyNames.has("watching")) db.exec(`ALTER TABLE companies ADD COLUMN watching INTEGER NOT NULL DEFAULT 0`);
  if (!companyNames.has("archived")) db.exec(`ALTER TABLE companies ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`);

  const jobCols = db.prepare(`PRAGMA table_info(jobs)`).all() as Array<{ name: string }>;
  const jobNames = new Set(jobCols.map((c) => c.name));
  if (!jobNames.has("resume_md")) db.exec(`ALTER TABLE jobs ADD COLUMN resume_md TEXT`);
  if (!jobNames.has("cover_letter_md")) db.exec(`ALTER TABLE jobs ADD COLUMN cover_letter_md TEXT`);

  return db;
}

function insertCompany(db: Database.Database, name: string): number {
  return (db.prepare(`INSERT INTO companies (name) VALUES (?) RETURNING id`).get(name) as { id: number }).id;
}

function insertJob(
  db: Database.Database,
  companyId: number,
  title: string,
  status = "needs_tailoring",
): number {
  const url = `https://example.com/job-${++_urlCounter}`;
  const sourceJobId = `job-${_urlCounter}`;
  return (
    db
      .prepare(
        `INSERT INTO jobs (company_id, title, source, source_job_id, url, status)
         VALUES (?, ?, 'manual', ?, ?, ?) RETURNING id`,
      )
      .get(companyId, title, sourceJobId, url, status) as { id: number }
  ).id;
}

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal mock Anthropic.messages.create() that simulates the tailor
 * agent performing start_tailoring → get_job → save_tailored → end_turn for
 * the given jobId.
 */
function makeSuccessCreate(jobId: number) {
  // Track which tool calls have been replied to via a tiny state machine
  const seenToolUseIds = new Set<string>();

  return vi.fn().mockImplementation(
    async (params: Anthropic.MessageCreateParamsNonStreaming): Promise<Partial<Anthropic.Message>> => {
      const lastMsg = params.messages[params.messages.length - 1];
      const toolResults: Anthropic.ToolResultBlockParam[] = Array.isArray(lastMsg?.content)
        ? (lastMsg.content as Anthropic.ContentBlockParam[]).filter(
            (b): b is Anthropic.ToolResultBlockParam => b.type === "tool_result",
          )
        : [];

      const newlyReplied = toolResults.map((r) => r.tool_use_id).filter((id) => !seenToolUseIds.has(id));
      for (const id of newlyReplied) seenToolUseIds.add(id);

      const hasReplied = (id: string) => seenToolUseIds.has(id);

      // Step 1: no tool results yet — call start_tailoring
      if (!hasReplied("tu_start")) {
        return {
          id: "msg_1",
          type: "message",
          role: "assistant",
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "tu_start", name: "start_tailoring", input: { id: jobId } }],
          usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        };
      }

      // Step 2: start_tailoring replied — call get_job
      if (!hasReplied("tu_get")) {
        return {
          id: "msg_2",
          type: "message",
          role: "assistant",
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "tu_get", name: "get_job", input: { id: jobId } }],
          usage: { input_tokens: 200, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        };
      }

      // Step 3: get_job replied — call save_tailored
      if (!hasReplied("tu_save")) {
        return {
          id: "msg_3",
          type: "message",
          role: "assistant",
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "tu_save",
              name: "save_tailored",
              input: {
                id: jobId,
                resume_md: `# Tailored Resume for job ${jobId}\n\nExperience`,
                cover_letter_md: `Dear HM,\n\nI am excited about job ${jobId}.`,
              },
            },
          ],
          usage: { input_tokens: 500, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        };
      }

      // Step 4: all tools called — end_turn
      return {
        id: "msg_4",
        type: "message",
        role: "assistant",
        stop_reason: "end_turn",
        content: [{ type: "text", text: `Tailoring complete for job ${jobId}.` }],
        usage: { input_tokens: 600, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      };
    },
  );
}

/**
 * Build a mock Anthropic client from a messages.create implementation.
 */
function makeClient(createFn: ReturnType<typeof vi.fn>): Anthropic {
  return {
    messages: { create: createFn },
  } as unknown as Anthropic;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("tailor.run()", () => {
  it("processes 2 needs_tailoring jobs: both advance to tailored, events logged", async () => {
    const db = setupDb();
    const companyId = insertCompany(db, "Acme Corp");
    const jobId1 = insertJob(db, companyId, "Senior Engineer");
    const jobId2 = insertJob(db, companyId, "Product Manager");

    // Separate mock clients for each job (run() creates one client and uses it for all)
    // We need a single client whose create() handles both jobs sequentially.
    // Each job gets its own state machine via makeSuccessCreate, but we need to route
    // calls to the right state machine based on which job is being processed.
    // Simplest: track call sequences per-job by intercepting the first user message.
    const stateMachines = new Map<number, ReturnType<typeof makeSuccessCreate>>();
    let currentJobId: number | null = null;

    const create = vi.fn().mockImplementation(
      async (params: Anthropic.MessageCreateParamsNonStreaming): Promise<Partial<Anthropic.Message>> => {
        // Detect job id from the first user message if not yet set
        if (currentJobId === null) {
          const firstContent = params.messages[0]?.content;
          const text = typeof firstContent === "string" ? firstContent : "";
          const match = text.match(/id=(\d+)/);
          if (match) currentJobId = parseInt(match[1], 10);
        }

        if (currentJobId === null) throw new Error("Could not detect job id from message");

        if (!stateMachines.has(currentJobId)) {
          stateMachines.set(currentJobId, makeSuccessCreate(currentJobId));
        }

        const result = await stateMachines.get(currentJobId)!(params);

        // Reset currentJobId when the agent returns end_turn so the next job gets fresh detection
        if ((result as Partial<Anthropic.Message>).stop_reason === "end_turn") {
          currentJobId = null;
        }

        return result as Partial<Anthropic.Message>;
      },
    );

    const report = await run(db, {}, makeClient(create));

    expect(report.processed).toBe(2);
    expect(report.succeeded).toBe(2);
    expect(report.failed).toBe(0);
    expect(typeof report.duration_ms).toBe("number");

    // Both jobs should now be tailored
    const job1 = db.prepare(`SELECT status FROM jobs WHERE id = ?`).get(jobId1) as { status: string };
    const job2 = db.prepare(`SELECT status FROM jobs WHERE id = ?`).get(jobId2) as { status: string };
    expect(job1.status).toBe("tailored");
    expect(job2.status).toBe("tailored");

    // tailoring_completed events for each job
    const completedEvents = db
      .prepare(`SELECT entity_id FROM events WHERE action = 'tailoring_completed'`)
      .all() as Array<{ entity_id: number }>;
    expect(completedEvents).toHaveLength(2);
    const completedIds = completedEvents.map((e) => e.entity_id).sort((a, b) => a - b);
    expect(completedIds).toEqual([jobId1, jobId2].sort((a, b) => a - b));

    // tailoring_run summary event
    const runEvents = db
      .prepare(`SELECT payload_json FROM events WHERE action = 'tailoring_run'`)
      .all() as Array<{ payload_json: string }>;
    expect(runEvents).toHaveLength(1);
    const runPayload = JSON.parse(runEvents[0].payload_json);
    expect(runPayload.processed).toBe(2);
    expect(runPayload.succeeded).toBe(2);
    expect(runPayload.failed).toBe(0);
  });

  it("job that throws during agent call stays in needs_tailoring, tailoring_failed event logged, partial success returned", async () => {
    const db = setupDb();
    const companyId = insertCompany(db, "BrokenCo");
    const jobId1 = insertJob(db, companyId, "Failing Engineer");

    const create = vi.fn().mockRejectedValue(new Error("Claude API rate limit"));
    const report = await run(db, {}, makeClient(create));

    expect(report.processed).toBe(1);
    expect(report.succeeded).toBe(0);
    expect(report.failed).toBe(1);

    // Job should still be in needs_tailoring
    const job = db.prepare(`SELECT status FROM jobs WHERE id = ?`).get(jobId1) as { status: string };
    expect(job.status).toBe("needs_tailoring");

    // tailoring_failed event with error_message
    const failedEvents = db
      .prepare(`SELECT payload_json FROM events WHERE action = 'tailoring_failed' AND entity_id = ?`)
      .all(jobId1) as Array<{ payload_json: string }>;
    expect(failedEvents).toHaveLength(1);
    const failedPayload = JSON.parse(failedEvents[0].payload_json);
    expect(failedPayload.job_id).toBe(jobId1);
    expect(failedPayload.error_message).toContain("Claude API rate limit");

    // tailoring_run summary event still logged
    const runEvents = db
      .prepare(`SELECT payload_json FROM events WHERE action = 'tailoring_run'`)
      .all() as Array<{ payload_json: string }>;
    expect(runEvents).toHaveLength(1);
    const runPayload = JSON.parse(runEvents[0].payload_json);
    expect(runPayload.processed).toBe(1);
    expect(runPayload.succeeded).toBe(0);
    expect(runPayload.failed).toBe(1);
  });

  it("respects --limit option", async () => {
    const db = setupDb();
    const companyId = insertCompany(db, "LimitCo");
    insertJob(db, companyId, "Job 1");
    insertJob(db, companyId, "Job 2");
    insertJob(db, companyId, "Job 3");

    // Fail all jobs so we can count how many were attempted
    const create = vi.fn().mockRejectedValue(new Error("intentional"));
    const report = await run(db, { limit: "2" }, makeClient(create));

    expect(report.processed).toBe(2);
  });

  it("returns empty report when no needs_tailoring jobs exist", async () => {
    const db = setupDb();
    const create = vi.fn();

    const report = await run(db, {}, makeClient(create));

    expect(report.processed).toBe(0);
    expect(report.succeeded).toBe(0);
    expect(report.failed).toBe(0);
    expect(create).not.toHaveBeenCalled();

    // tailoring_run event should still be logged even with empty queue
    const runEvents = db
      .prepare(`SELECT payload_json FROM events WHERE action = 'tailoring_run'`)
      .all() as Array<{ payload_json: string }>;
    expect(runEvents).toHaveLength(1);
  });
});
