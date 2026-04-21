import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mock next/server Response so it works in jsdom
// ---------------------------------------------------------------------------

// Capture the mock prepare statement so tests can control return values
let mockGet: ReturnType<typeof vi.fn>;

vi.mock("@/lib/db", () => {
  mockGet = vi.fn();
  return {
    getDb: () => ({
      prepare: () => ({ get: mockGet }),
    }),
  };
});

// Import after mock registration
const { GET } = await import("./route");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(id: string, type?: string): NextRequest {
  const url = `http://localhost/api/jobs/${id}/pdf${type ? `?type=${type}` : ""}`;
  return new NextRequest(url);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/jobs/[id]/pdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when type param is missing", async () => {
    const res = await GET(makeRequest("1"), { params: { id: "1" } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/type param/);
  });

  it("returns 400 for an invalid type param", async () => {
    const res = await GET(makeRequest("1", "invalid"), { params: { id: "1" } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/type param/);
  });

  it("returns 404 when PDF column is null (resume)", async () => {
    mockGet.mockReturnValue({ resume_pdf: null, resume_pdf_mime: null });
    const res = await GET(makeRequest("1", "resume"), { params: { id: "1" } });
    expect(res.status).toBe(404);
  });

  it("returns 404 when PDF column is null (cover_letter)", async () => {
    mockGet.mockReturnValue({ cover_letter_pdf: null, cover_letter_pdf_mime: null });
    const res = await GET(makeRequest("1", "cover_letter"), { params: { id: "1" } });
    expect(res.status).toBe(404);
  });

  it("returns 404 when job row is not found", async () => {
    mockGet.mockReturnValue(undefined);
    const res = await GET(makeRequest("999", "resume"), { params: { id: "999" } });
    expect(res.status).toBe(404);
  });

  it("returns PDF bytes with correct Content-Type for resume", async () => {
    const fakePdf = Buffer.from("%PDF-1.4 test");
    mockGet.mockReturnValue({ resume_pdf: fakePdf, resume_pdf_mime: "application/pdf" });
    const res = await GET(makeRequest("1", "resume"), { params: { id: "1" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain("resume.pdf");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.toString()).toBe("%PDF-1.4 test");
  });

  it("returns PDF bytes with correct Content-Type for cover_letter", async () => {
    const fakePdf = Buffer.from("%PDF-1.4 cover");
    mockGet.mockReturnValue({ cover_letter_pdf: fakePdf, cover_letter_pdf_mime: "application/pdf" });
    const res = await GET(makeRequest("2", "cover_letter"), { params: { id: "2" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain("cover_letter.pdf");
  });
});
