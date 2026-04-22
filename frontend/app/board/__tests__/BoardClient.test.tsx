import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import BoardClient from "../BoardClient";
import type { Job } from "@/lib/types";

// ---------------------------------------------------------------------------
// Minimal mock for dnd-kit (not relevant to our unit tests)
// ---------------------------------------------------------------------------
vi.mock("@dnd-kit/core", async () => {
  const actual = await vi.importActual<typeof import("@dnd-kit/core")>("@dnd-kit/core");
  return {
    ...actual,
    DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useDraggable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: () => {},
      transform: null,
      isDragging: false,
    }),
    useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
    useSensor: () => ({}),
    useSensors: (...args: unknown[]) => args,
    PointerSensor: class {},
  };
});

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 1,
    title: "Staff Engineer",
    company: "Acme Corp",
    location: "Remote",
    salary_range: null,
    url: null,
    source: null,
    description: null,
    score: null,
    match_explanation: null,
    status: "tailored",
    rejection_reason: null,
    rejection_note: null,
    approval_reason: null,
    approval_note: null,
    notes: null,
    resume_tex: null,
    resume_md: null,
    resume_json: null,
    cover_letter_md: null,
    submitted_at: null,
    discovered_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: Drawer renders tailoring outputs
// ---------------------------------------------------------------------------
describe("Drawer: resume and cover letter rendering", () => {
  it("renders resume PDF iframe when job has resume_md", async () => {
    const job = makeJob({ status: "tailored", resume_md: "# My Resume\n\nEngineering lead." });
    render(<BoardClient initialJobs={[job]} />);

    fireEvent.click(screen.getByText("Staff Engineer"));

    const iframe = screen.getByTitle("Tailored Resume PDF") as HTMLIFrameElement;
    expect(iframe).toBeDefined();
    expect(iframe.src).toContain("/api/jobs/1/pdf?type=resume");
  });

  it("renders resume PDF iframe when job has resume_json (backward compat)", async () => {
    const job = makeJob({
      status: "tailored",
      resume_json: JSON.stringify({ name: "Jane", contact: { email: "j@j.com" }, experience: [], education: [] }),
    });
    render(<BoardClient initialJobs={[job]} />);

    fireEvent.click(screen.getByText("Staff Engineer"));

    const iframe = screen.getByTitle("Tailored Resume PDF") as HTMLIFrameElement;
    expect(iframe).toBeDefined();
    expect(iframe.src).toContain("/api/jobs/1/pdf?type=resume");
  });

  it("renders cover_letter_md content as plain text in <pre>", async () => {
    const job = makeJob({
      status: "tailored",
      cover_letter_md: "Dear Hiring Manager,\n\nI am excited to apply.",
    });
    render(<BoardClient initialJobs={[job]} />);

    fireEvent.click(screen.getByText("Staff Engineer"));

    expect(screen.getByText(/Dear Hiring Manager/)).toBeDefined();
    expect(screen.getByText(/I am excited to apply/)).toBeDefined();
  });

  it("shows Download PDF link for resume when resume_md is present", async () => {
    const job = makeJob({ status: "tailored", resume_md: "# Resume content" });
    render(<BoardClient initialJobs={[job]} />);

    fireEvent.click(screen.getByText("Staff Engineer"));

    const resumeLink = screen.getByTestId("resume-pdf-link") as HTMLAnchorElement;
    expect(resumeLink).toBeDefined();
    expect(resumeLink.href).toContain("/api/jobs/1/pdf?type=resume");
  });

  it("does not show Download PDF for cover letter", async () => {
    const job = makeJob({ status: "tailored", cover_letter_md: "Dear Hiring Manager" });
    render(<BoardClient initialJobs={[job]} />);

    fireEvent.click(screen.getByText("Staff Engineer"));

    // There should be no anchor with cover_letter in href
    const allLinks = screen.queryAllByRole("link");
    const coverLetterPdfLink = allLinks.find(
      (el) => (el as HTMLAnchorElement).href?.includes("cover_letter"),
    );
    expect(coverLetterPdfLink).toBeUndefined();
  });

  it("shows Copy button when cover letter text is present", async () => {
    const job = makeJob({ status: "tailored", cover_letter_md: "Dear Hiring Manager" });
    render(<BoardClient initialJobs={[job]} />);

    fireEvent.click(screen.getByText("Staff Engineer"));

    const copyBtn = screen.getByTestId("cover-letter-copy");
    expect(copyBtn).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: Approve button
// ---------------------------------------------------------------------------
describe("Approve button on tailored card", () => {
  it("calls PATCH /api/jobs/[id] with { status: 'ready_to_apply' } when Approve is clicked on a card", async () => {
    const job = makeJob({ status: "tailored" });
    render(<BoardClient initialJobs={[job]} />);

    fireEvent.click(screen.getByText("Approve"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/jobs/1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ status: "ready_to_apply" }),
        }),
      );
    });
  });

  it("shows Approve button in the drawer for a tailored job and calls PATCH on click", async () => {
    const job = makeJob({ status: "tailored", resume_md: "# Resume" });
    render(<BoardClient initialJobs={[job]} />);

    // Open drawer
    fireEvent.click(screen.getByText("Staff Engineer"));

    // Approve button in the drawer header
    const approveButtons = screen.getAllByText(/Approve/);
    // Click the drawer's Approve button (inside the drawer)
    fireEvent.click(approveButtons[approveButtons.length - 1]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/jobs/1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ status: "ready_to_apply" }),
        }),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: Edit mode
// ---------------------------------------------------------------------------
describe("Drawer edit mode", () => {
  it("switches to textarea for inline edits when Edit is toggled", async () => {
    const job = makeJob({ status: "tailored", resume_md: "# Original Resume" });
    render(<BoardClient initialJobs={[job]} />);

    fireEvent.click(screen.getByText("Staff Engineer"));
    fireEvent.click(screen.getByTestId("drawer-edit-toggle"));

    const textarea = screen.getByTestId("resume-editor") as HTMLTextAreaElement;
    expect(textarea).toBeDefined();
    expect(textarea.value).toBe("# Original Resume");
  });

  it("saves resume_md via PATCH when Save Resume is clicked in edit mode", async () => {
    const job = makeJob({ status: "tailored", resume_md: "# Original Resume" });
    render(<BoardClient initialJobs={[job]} />);

    fireEvent.click(screen.getByText("Staff Engineer"));
    fireEvent.click(screen.getByTestId("drawer-edit-toggle"));

    const textarea = screen.getByTestId("resume-editor") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "# Updated Resume" } });

    fireEvent.click(screen.getByTestId("resume-save"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/jobs/1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ resume_md: "# Updated Resume" }),
        }),
      );
    });
  });

  it("saves cover_letter_md via PATCH when Save Cover Letter is clicked in edit mode", async () => {
    const job = makeJob({ status: "tailored", cover_letter_md: "Original cover letter" });
    render(<BoardClient initialJobs={[job]} />);

    fireEvent.click(screen.getByText("Staff Engineer"));
    fireEvent.click(screen.getByTestId("drawer-edit-toggle"));

    const textarea = screen.getByTestId("cover-letter-editor") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Updated cover letter" } });

    fireEvent.click(screen.getByTestId("cover-letter-save"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/jobs/1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ cover_letter_md: "Updated cover letter" }),
        }),
      );
    });
  });

  it("opens drawer in edit mode when Edit button is clicked on a tailored card", async () => {
    const job = makeJob({ status: "tailored", resume_md: "# Resume" });
    render(<BoardClient initialJobs={[job]} />);

    // Click the Edit button on the card (not the drawer toggle)
    const editButtons = screen.getAllByText("Edit");
    // The card's Edit button is the first one rendered (before drawer opens)
    fireEvent.click(editButtons[0]);

    // Drawer should open in edit mode — textarea should be present
    expect(screen.getByTestId("resume-editor")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: Tailor button
// ---------------------------------------------------------------------------
describe("Tailor button on needs_tailoring card", () => {
  it("calls POST /api/jobs/[id]/tailor when Tailor is clicked", async () => {
    const job = makeJob({ status: "needs_tailoring" });
    render(<BoardClient initialJobs={[job]} />);

    fireEvent.click(screen.getByText("Tailor"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/jobs/1/tailor",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("shows spinner badge after Tailor is clicked (optimistic status → tailoring)", async () => {
    const job = makeJob({ status: "needs_tailoring" });
    render(<BoardClient initialJobs={[job]} />);

    fireEvent.click(screen.getByText("Tailor"));

    await waitFor(() => {
      expect(screen.getByText(/Tailoring in progress/)).toBeDefined();
    });
  });
});
