import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Mock md-to-pdf so tests don't launch a browser
// ---------------------------------------------------------------------------

vi.mock("md-to-pdf", () => ({
  mdToPdf: async ({ content }: { content: string }) => ({
    content: Buffer.from(`%PDF-1.4 mock pdf for: ${content.slice(0, 20)}`),
  }),
}));

// Import after mock is registered
const { renderPdf, renderJobPdfs } = await import("./pdf");

// ---------------------------------------------------------------------------
// DB setup
// ---------------------------------------------------------------------------

function setupDb(): Database.Database {
  const db = new Database(":memory:");
  // schema.sql already includes resume_pdf / cover_letter_pdf columns on this branch
  db.exec(readFileSync(resolve(__dirname, "schema.sql"), "utf8"));
  return db;
}

function insertJobWithDocs(
  db: Database.Database,
  id: number,
  resume_md: string | null,
  cover_letter_md: string | null,
) {
  db.prepare(`INSERT INTO companies (id, name) VALUES (?, ?)`).run(id, `co${id}`);
  db.prepare(
    `INSERT INTO jobs (id, title, company_id, status, url, resume_md, cover_letter_md)
     VALUES (?, ?, ?, 'tailored', ?, ?, ?)`,
  ).run(id, `Job ${id}`, id, `https://example.com/${id}`, resume_md, cover_letter_md);
}

// ---------------------------------------------------------------------------
// Tests: renderPdf
// ---------------------------------------------------------------------------

describe("renderPdf", () => {
  it("returns a Buffer with %PDF magic bytes", async () => {
    const buf = await renderPdf("# Hello\n\nThis is a test.");
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.slice(0, 4).toString()).toBe("%PDF");
  });

  it("produces non-empty output for minimal markdown", async () => {
    const buf = await renderPdf("hello");
    expect(buf.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: renderJobPdfs
// ---------------------------------------------------------------------------

describe("renderJobPdfs", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  it("writes non-zero byte BLOBs to DB and returns byte counts", async () => {
    insertJobWithDocs(db, 1, "# Resume\n\nContent", "# Cover Letter\n\nHello");
    const result = await renderJobPdfs(db, 1);

    expect(result.resume_bytes).toBeGreaterThan(0);
    expect(result.cover_letter_bytes).toBeGreaterThan(0);

    const row = db
      .prepare(`SELECT resume_pdf, resume_pdf_mime, cover_letter_pdf, cover_letter_pdf_mime FROM jobs WHERE id = ?`)
      .get(1) as {
        resume_pdf: Buffer | null;
        resume_pdf_mime: string | null;
        cover_letter_pdf: Buffer | null;
        cover_letter_pdf_mime: string | null;
      };

    expect(row.resume_pdf).not.toBeNull();
    expect(row.resume_pdf!.length).toBe(result.resume_bytes);
    expect(row.resume_pdf_mime).toBe("application/pdf");
    expect(row.cover_letter_pdf).not.toBeNull();
    expect(row.cover_letter_pdf!.length).toBe(result.cover_letter_bytes);
    expect(row.cover_letter_pdf_mime).toBe("application/pdf");
  });

  it("logs a pdf_rendered event with byte counts and duration_ms", async () => {
    insertJobWithDocs(db, 2, "# R", "# CL");
    await renderJobPdfs(db, 2);

    const event = db
      .prepare(`SELECT payload_json FROM events WHERE entity_type='job' AND entity_id=? AND action='pdf_rendered'`)
      .get(2) as { payload_json: string } | undefined;

    expect(event).toBeDefined();
    const payload = JSON.parse(event!.payload_json);
    expect(payload.resume_bytes).toBeGreaterThan(0);
    expect(payload.cover_letter_bytes).toBeGreaterThan(0);
    expect(typeof payload.duration_ms).toBe("number");
  });

  it("throws an error if resume_md is null", async () => {
    insertJobWithDocs(db, 3, null, "# Cover Letter");
    await expect(renderJobPdfs(db, 3)).rejects.toThrow(/no resume_md/);
  });

  it("throws an error if cover_letter_md is null", async () => {
    insertJobWithDocs(db, 4, "# Resume", null);
    await expect(renderJobPdfs(db, 4)).rejects.toThrow(/no cover_letter_md/);
  });

  it("throws an error if job does not exist", async () => {
    await expect(renderJobPdfs(db, 9999)).rejects.toThrow(/not found/);
  });
});
