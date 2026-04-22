import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ResumeJson } from "../render/schema";

// ---------------------------------------------------------------------------
// Mock renderResumePdf before importing anything that uses it
// ---------------------------------------------------------------------------
vi.mock("../render/resume", () => ({
  renderResumePdf: vi.fn().mockResolvedValue(Buffer.from("%PDF-fake")),
}));

// Import the mock so tests can control it
import { renderResumePdf } from "../render/resume";
const mockRenderResumePdf = vi.mocked(renderResumePdf);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(readFileSync(resolve(__dirname, "../schema.sql"), "utf8"));
  // Add new columns not yet in schema.sql (added by migrate() at runtime)
  db.exec(`ALTER TABLE jobs ADD COLUMN resume_json TEXT`);
  db.exec(`ALTER TABLE profile ADD COLUMN base_resume_json TEXT`);
  return db;
}

function insertCompany(db: Database.Database, id: number, name: string) {
  db.prepare(`INSERT INTO companies (id, name) VALUES (?, ?)`).run(id, name);
}

function insertJob(
  db: Database.Database,
  id: number,
  companyId: number,
  status: string,
): void {
  db.prepare(
    `INSERT INTO jobs (id, title, company_id, status, description, url)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, `Job ${id}`, companyId, status, `Description for job ${id}`, `https://example.com/job/${id}`);
}

function insertProfile(db: Database.Database, baseResumeMd: string | null, baseResumeJson?: string | null) {
  db.prepare(
    `INSERT INTO profile (id, full_name, base_resume_md, base_resume_json) VALUES (1, 'Test User', ?, ?)`,
  ).run(baseResumeMd, baseResumeJson ?? null);
}

function getJobStatus(db: Database.Database, id: number): string | null {
  const row = db.prepare(`SELECT status FROM jobs WHERE id = ?`).get(id) as
    | { status: string }
    | undefined;
  return row?.status ?? null;
}

function getJobFields(db: Database.Database, id: number) {
  return db.prepare(`SELECT resume_json, resume_pdf, cover_letter_md, status FROM jobs WHERE id = ?`).get(id) as
    | { resume_json: string | null; resume_pdf: Buffer | null; cover_letter_md: string | null; status: string }
    | undefined;
}

function getEvents(db: Database.Database, jobId: number) {
  return db
    .prepare(`SELECT action, payload_json FROM events WHERE entity_type='job' AND entity_id=? ORDER BY id`)
    .all(jobId) as Array<{ action: string; payload_json: string | null }>;
}

// ---------------------------------------------------------------------------
// Inline implementations of the MCP tool handlers
// (mirrors backend/mcp/server.ts exactly — tests the logic without the MCP layer)
// ---------------------------------------------------------------------------

function getJobTool(db: Database.Database, id: number) {
  const job = db
    .prepare(
      `SELECT j.*, c.name AS company_name
         FROM jobs j LEFT JOIN companies c ON c.id = j.company_id
        WHERE j.id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!job) return { error: `job ${id} not found` };
  const profile = db.prepare(`SELECT base_resume_md, base_resume_json FROM profile WHERE id = 1`).get() as
    | { base_resume_md: string | null; base_resume_json: string | null }
    | undefined;
  job.base_resume_md = profile?.base_resume_md ?? null;
  job.base_resume_json = profile?.base_resume_json
    ? JSON.parse(profile.base_resume_json as string)
    : null;
  return { job };
}

function startTailoringTool(db: Database.Database, id: number) {
  const job = db.prepare(`SELECT id, status FROM jobs WHERE id = ?`).get(id) as
    | { id: number; status: string }
    | undefined;
  if (!job) return { error: `job ${id} not found` };
  if (job.status !== "needs_tailoring") {
    return { error: `job ${id} is in status '${job.status}', expected 'needs_tailoring'` };
  }
  db.prepare(`UPDATE jobs SET status = 'tailoring', updated_at = datetime('now') WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO events (entity_type, entity_id, action, actor, payload_json) VALUES ('job', ?, 'tailoring_started', 'claude', ?)`,
  ).run(id, JSON.stringify({ job_id: id }));
  return { ok: true };
}

import { ResumeJsonSchema } from "../render/schema";

async function saveTailoredTool(
  db: Database.Database,
  id: number,
  resume_json: unknown,
  cover_letter_md: string,
) {
  const job = db.prepare(`SELECT id FROM jobs WHERE id = ?`).get(id) as { id: number } | undefined;
  if (!job) return { error: `job ${id} not found` };

  // Parse
  let resumeObj: unknown;
  try {
    resumeObj = typeof resume_json === "string" ? JSON.parse(resume_json) : resume_json;
  } catch (e) {
    return { error: `invalid resume_json: ${(e as Error).message}` };
  }

  // Validate
  let resumeData: ResumeJson;
  try {
    resumeData = ResumeJsonSchema.parse(resumeObj);
  } catch (e) {
    return { error: `invalid resume_json: ${(e as Error).message}` };
  }

  // Render
  const start = Date.now();
  let buf: Buffer;
  try {
    buf = await renderResumePdf(resumeData);
  } catch (e) {
    return { error: `render failed: ${(e as Error).message}` };
  }
  const duration_ms = Date.now() - start;

  // Write
  db.prepare(
    `UPDATE jobs SET resume_json = ?, resume_pdf = ?, resume_pdf_mime = 'application/pdf',
     cover_letter_md = ?, status = 'tailored', updated_at = datetime('now') WHERE id = ?`,
  ).run(JSON.stringify(resumeData), buf, cover_letter_md, id);

  const resume_pdf_bytes = buf.length;
  db.prepare(
    `INSERT INTO events (entity_type, entity_id, action, actor, payload_json) VALUES ('job', ?, 'tailoring_completed', 'claude', ?)`,
  ).run(id, JSON.stringify({ resume_pdf_bytes, duration_ms }));

  return { resume_pdf_bytes, duration_ms };
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const VALID_RESUME_JSON: ResumeJson = {
  name: "Jane Smith",
  contact: { email: "jane@example.com" },
  experience: [{ company: "Acme", title: "PM", dates: "2020–present", bullets: ["Led team of 5"] }],
  education: [{ institution: "MIT", degree: "BS CS", dates: "2016" }],
};
const COVER = "Dear Hiring Manager,\n\nI am excited to apply.";

// ---------------------------------------------------------------------------
// Tests: get_job
// ---------------------------------------------------------------------------

describe("get_job", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = setupDb();
    insertCompany(db, 1, "Acme Corp");
    insertJob(db, 101, 1, "needs_tailoring");
  });

  it("returns merged job + company_name + base_resume_md", () => {
    insertProfile(db, "# My Base Resume\n\nExperience...");
    const result = getJobTool(db, 101);
    expect(result.error).toBeUndefined();
    expect(result.job).toBeDefined();
    expect(result.job!.title).toBe("Job 101");
    expect(result.job!.company_name).toBe("Acme Corp");
    expect(result.job!.base_resume_md).toBe("# My Base Resume\n\nExperience...");
  });

  it("returns base_resume_json parsed when profile has it", () => {
    const jsonData = { name: "Test", contact: { email: "t@t.com" }, experience: [], education: [] };
    insertProfile(db, null, JSON.stringify(jsonData));
    const result = getJobTool(db, 101);
    expect(result.job!.base_resume_json).toEqual(jsonData);
  });

  it("returns base_resume_md as null when no profile exists", () => {
    const result = getJobTool(db, 101);
    expect(result.job!.base_resume_md).toBeNull();
  });

  it("returns base_resume_json as null when profile has no json", () => {
    insertProfile(db, "# Resume");
    const result = getJobTool(db, 101);
    expect(result.job!.base_resume_json).toBeNull();
  });

  it("returns error for non-existent job id", () => {
    const result = getJobTool(db, 9999);
    expect(result.error).toMatch(/not found/);
    expect(result.job).toBeUndefined();
  });

  it("includes all job columns in the response", () => {
    const result = getJobTool(db, 101);
    const job = result.job!;
    expect(job.id).toBe(101);
    expect(job.status).toBe("needs_tailoring");
    expect(job.description).toBe("Description for job 101");
  });
});

// ---------------------------------------------------------------------------
// Tests: start_tailoring
// ---------------------------------------------------------------------------

describe("start_tailoring", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = setupDb();
    insertCompany(db, 1, "Acme Corp");
  });

  it("transitions needs_tailoring → tailoring", () => {
    insertJob(db, 101, 1, "needs_tailoring");
    const result = startTailoringTool(db, 101);
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(getJobStatus(db, 101)).toBe("tailoring");
  });

  it("logs a tailoring_started event with job_id", () => {
    insertJob(db, 101, 1, "needs_tailoring");
    startTailoringTool(db, 101);
    const events = getEvents(db, 101);
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe("tailoring_started");
    const payload = JSON.parse(events[0].payload_json!);
    expect(payload.job_id).toBe(101);
  });

  it("returns error when job is not in needs_tailoring status", () => {
    insertJob(db, 102, 1, "new");
    const result = startTailoringTool(db, 102);
    expect(result.error).toMatch(/needs_tailoring/);
    expect(getJobStatus(db, 102)).toBe("new"); // unchanged
  });

  it("returns error for each non-needs_tailoring status", () => {
    const badStatuses = ["fetched", "prescored", "tailoring", "tailored", "approved", "rejected"];
    badStatuses.forEach((status, i) => {
      insertJob(db, 200 + i, 1, status);
      const result = startTailoringTool(db, 200 + i);
      expect(result.error).toBeDefined();
      expect(getJobStatus(db, 200 + i)).toBe(status); // not mutated
    });
  });

  it("returns error for non-existent job id", () => {
    const result = startTailoringTool(db, 9999);
    expect(result.error).toMatch(/not found/);
  });
});

// ---------------------------------------------------------------------------
// Tests: save_tailored
// ---------------------------------------------------------------------------

describe("save_tailored", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
    insertCompany(db, 1, "Acme Corp");
    insertJob(db, 101, 1, "tailoring");
    mockRenderResumePdf.mockResolvedValue(Buffer.from("%PDF-fake"));
  });

  it("writes resume_json and resume_pdf to the job row", async () => {
    await saveTailoredTool(db, 101, VALID_RESUME_JSON, COVER);
    const fields = getJobFields(db, 101)!;
    expect(fields.resume_json).toBe(JSON.stringify(VALID_RESUME_JSON));
    expect(fields.resume_pdf).toBeDefined();
    expect(Buffer.isBuffer(fields.resume_pdf)).toBe(true);
  });

  it("writes cover_letter_md to the job row", async () => {
    await saveTailoredTool(db, 101, VALID_RESUME_JSON, COVER);
    const fields = getJobFields(db, 101)!;
    expect(fields.cover_letter_md).toBe(COVER);
  });

  it("advances status to tailored", async () => {
    await saveTailoredTool(db, 101, VALID_RESUME_JSON, COVER);
    expect(getJobStatus(db, 101)).toBe("tailored");
  });

  it("returns resume_pdf_bytes", async () => {
    const result = await saveTailoredTool(db, 101, VALID_RESUME_JSON, COVER);
    expect(result.resume_pdf_bytes).toBe(Buffer.from("%PDF-fake").length);
  });

  it("logs a tailoring_completed event with resume_pdf_bytes", async () => {
    await saveTailoredTool(db, 101, VALID_RESUME_JSON, COVER);
    const events = getEvents(db, 101);
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe("tailoring_completed");
    const payload = JSON.parse(events[0].payload_json!);
    expect(payload.resume_pdf_bytes).toBe(Buffer.from("%PDF-fake").length);
    expect(typeof payload.duration_ms).toBe("number");
  });

  it("accepts resume_json as a JSON string", async () => {
    await saveTailoredTool(db, 101, JSON.stringify(VALID_RESUME_JSON), COVER);
    expect(getJobStatus(db, 101)).toBe("tailored");
  });

  it("returns error for invalid resume_json (missing required fields)", async () => {
    const result = await saveTailoredTool(db, 101, { name: "Bad" }, COVER);
    expect(result.error).toMatch(/invalid resume_json/);
    // Status should not change
    expect(getJobStatus(db, 101)).toBe("tailoring");
  });

  it("returns error and keeps status=tailoring when render fails", async () => {
    mockRenderResumePdf.mockRejectedValueOnce(new Error("chromium crashed"));
    const result = await saveTailoredTool(db, 101, VALID_RESUME_JSON, COVER);
    expect(result.error).toMatch(/render failed/);
    expect(getJobStatus(db, 101)).toBe("tailoring");
  });

  it("returns error for non-existent job id", async () => {
    const result = await saveTailoredTool(db, 9999, VALID_RESUME_JSON, COVER);
    expect(result.error).toMatch(/not found/);
  });
});
