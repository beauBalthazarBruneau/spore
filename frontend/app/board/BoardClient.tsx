"use client";
import { useMemo, useState, useCallback } from "react";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { BOARD_COLUMNS, BOARD_SIDE, type Job, type JobStatus } from "@/lib/types";

const COLUMN_LABELS: Record<JobStatus, string> = {
  fetched: "Fetched",
  new: "To Review",
  needs_tailoring: "Needs Tailoring",
  tailoring: "Tailoring",
  tailored: "Tailored",
  ready_to_apply: "Ready to Apply",
  applied: "Applied",
  interview_invite: "Interview Invite",
  declined: "Declined",
  on_hold: "On Hold",
  approved: "",
  rejected: "",
  skipped: "",
};

// ---------------------------------------------------------------------------
// Simple markdown → HTML (no external dep needed for basic formatting)
// ---------------------------------------------------------------------------
function mdToHtml(md: string): string {
  return md
    // headings
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    // bold/italic
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // inline code
    .replace(/`(.+?)`/g, "<code>$1</code>")
    // unordered list items
    .replace(/^[-*] (.+)$/gm, "<li>$1</li>")
    // horizontal rule
    .replace(/^---$/gm, "<hr />")
    // paragraphs: blank lines become <br /><br />
    .replace(/\n\n/g, "<br /><br />")
    // line breaks within paragraphs
    .replace(/\n/g, "<br />");
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function BoardClient({ initialJobs }: { initialJobs: Job[] }) {
  const [jobs, setJobs] = useState(initialJobs);
  const [selected, setSelected] = useState<Job | null>(null);
  const [drawerEditMode, setDrawerEditMode] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const byStatus = useMemo(() => {
    const m: Record<string, Job[]> = {};
    for (const j of jobs) (m[j.status] ??= []).push(j);
    return m;
  }, [jobs]);

  const updateJobLocally = useCallback((id: number, patch: Partial<Job>) => {
    setJobs((all) => all.map((j) => (j.id === id ? { ...j, ...patch } : j)));
    setSelected((s) => (s?.id === id ? { ...s, ...patch } : s));
  }, []);

  async function onDragEnd(e: DragEndEvent) {
    const jobId = Number(e.active.id);
    const target = e.over?.id as JobStatus | undefined;
    if (!target) return;
    const job = jobs.find((j) => j.id === jobId);
    if (!job || job.status === target) return;
    updateJobLocally(jobId, { status: target });
    await fetch(`/api/jobs/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: target }),
    });
  }

  async function onTailor(jobId: number) {
    updateJobLocally(jobId, { status: "tailoring" });
    const res = await fetch(`/api/jobs/${jobId}/tailor`, { method: "POST" });
    if (!res.ok) {
      // revert on failure
      const job = await fetch(`/api/jobs/${jobId}`).then((r) => r.json());
      updateJobLocally(jobId, { status: job.status });
    }
  }

  async function onApprove(jobId: number) {
    updateJobLocally(jobId, { status: "ready_to_apply" });
    await fetch(`/api/jobs/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ready_to_apply" }),
    });
  }

  async function onSaveField(jobId: number, field: "resume_md" | "cover_letter_md", value: string) {
    updateJobLocally(jobId, { [field]: value });
    await fetch(`/api/jobs/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
  }

  function openDrawer(job: Job, editMode = false) {
    setSelected(job);
    setDrawerEditMode(editMode);
  }

  return (
    <div className="p-4">
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {BOARD_COLUMNS.map((col) => (
            <Column
              key={col}
              status={col}
              jobs={byStatus[col] ?? []}
              onOpen={openDrawer}
              onTailor={onTailor}
              onApprove={onApprove}
            />
          ))}
        </div>
        <div className="flex gap-3 mt-4 opacity-70">
          {BOARD_SIDE.map((col) => (
            <Column
              key={col}
              status={col}
              jobs={byStatus[col] ?? []}
              onOpen={openDrawer}
              onTailor={onTailor}
              onApprove={onApprove}
              compact
            />
          ))}
        </div>
      </DndContext>
      {selected && (
        <Drawer
          job={selected}
          editMode={drawerEditMode}
          onToggleEdit={() => setDrawerEditMode((v) => !v)}
          onClose={() => setSelected(null)}
          onSaveField={onSaveField}
          onApprove={onApprove}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Column
// ---------------------------------------------------------------------------
function Column({
  status,
  jobs,
  onOpen,
  onTailor,
  onApprove,
  compact,
}: {
  status: JobStatus;
  jobs: Job[];
  onOpen: (j: Job, editMode?: boolean) => void;
  onTailor: (id: number) => void;
  onApprove: (id: number) => void;
  compact?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={`flex-1 min-w-[220px] rounded-lg border border-zinc-800 bg-zinc-900/40 ${
        isOver ? "ring-2 ring-emerald-500" : ""
      }`}
    >
      <div className="px-3 py-2 border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-400 flex justify-between">
        <span>{COLUMN_LABELS[status]}</span>
        <span>{jobs.length}</span>
      </div>
      <div className={`p-2 space-y-2 ${compact ? "max-h-32 overflow-auto" : "min-h-[60vh]"}`}>
        {jobs.map((j) => (
          <Card
            key={j.id}
            job={j}
            onOpen={onOpen}
            onTailor={onTailor}
            onApprove={onApprove}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
function Card({
  job,
  onOpen,
  onTailor,
  onApprove,
}: {
  job: Job;
  onOpen: (j: Job, editMode?: boolean) => void;
  onTailor: (id: number) => void;
  onApprove: (id: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: String(job.id),
  });

  const isTailoring = job.status === "tailoring";
  const isTailored = job.status === "tailored";
  const isNeedsTailoring = job.status === "needs_tailoring";

  function handleActionClick(e: React.MouseEvent, fn: () => void) {
    e.stopPropagation();
    fn();
  }

  return (
    <div
      ref={setNodeRef}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={`rounded-md bg-zinc-900 border border-zinc-800 p-2 cursor-grab active:cursor-grabbing ${
        isDragging ? "opacity-60" : ""
      }`}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(job)}
    >
      <div className="text-sm font-medium">{job.title}</div>
      <div className="text-xs text-zinc-400">{job.company}</div>
      {job.location && <div className="text-[11px] text-zinc-500 mt-0.5">{job.location}</div>}

      {isTailoring && (
        <div className="mt-2 flex items-center gap-1 text-[11px] text-amber-400">
          <Spinner /> Tailoring in progress…
        </div>
      )}

      {isNeedsTailoring && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[10px] bg-amber-900/40 text-amber-300 px-1.5 py-0.5 rounded">
            needs tailoring
          </span>
          <button
            className="text-[11px] bg-emerald-800/60 hover:bg-emerald-700/70 text-emerald-300 px-2 py-0.5 rounded"
            onClick={(e) => handleActionClick(e, () => onTailor(job.id))}
          >
            Tailor
          </button>
        </div>
      )}

      {isTailored && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[10px] bg-teal-900/40 text-teal-300 px-1.5 py-0.5 rounded">
            tailored
          </span>
          <button
            className="text-[11px] bg-emerald-800/60 hover:bg-emerald-700/70 text-emerald-300 px-2 py-0.5 rounded"
            onClick={(e) => handleActionClick(e, () => onApprove(job.id))}
          >
            Approve
          </button>
          <button
            className="text-[11px] bg-zinc-700/60 hover:bg-zinc-600/70 text-zinc-300 px-2 py-0.5 rounded"
            onClick={(e) => handleActionClick(e, () => onOpen(job, true))}
          >
            Edit
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------
function Drawer({
  job,
  editMode,
  onToggleEdit,
  onClose,
  onSaveField,
  onApprove,
}: {
  job: Job;
  editMode: boolean;
  onToggleEdit: () => void;
  onClose: () => void;
  onSaveField: (id: number, field: "resume_md" | "cover_letter_md", value: string) => void;
  onApprove: (id: number) => void;
}) {
  const [resumeDraft, setResumeDraft] = useState(job.resume_md ?? "");
  const [coverLetterDraft, setCoverLetterDraft] = useState(job.cover_letter_md ?? "");

  // Keep drafts in sync if job prop changes (e.g. after a save)
  const [lastJobId, setLastJobId] = useState(job.id);
  if (job.id !== lastJobId) {
    setResumeDraft(job.resume_md ?? "");
    setCoverLetterDraft(job.cover_letter_md ?? "");
    setLastJobId(job.id);
  }

  function saveResume() {
    onSaveField(job.id, "resume_md", resumeDraft);
  }
  function saveCoverLetter() {
    onSaveField(job.id, "cover_letter_md", coverLetterDraft);
  }

  const hasResume = Boolean(job.resume_md || job.resume_json);

  return (
    <div
      className="fixed inset-0 bg-black/60 flex justify-end z-50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl h-full bg-zinc-950 border-l border-zinc-800 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-zinc-800 flex-shrink-0">
          <div>
            <h1 className="text-lg font-semibold">{job.title}</h1>
            <div className="text-zinc-400 text-sm">{job.company}</div>
            <div className="text-xs text-zinc-500 mt-0.5">
              {[job.location, job.salary_range].filter(Boolean).join(" · ")}
              {" · "}
              <span className="text-zinc-400">{job.status}</span>
            </div>
            {job.url && (
              <a className="text-xs text-blue-400 hover:underline" href={job.url} target="_blank" rel="noreferrer">
                source ↗
              </a>
            )}
          </div>
          <div className="flex items-center gap-2 ml-4">
            {job.status === "tailored" && (
              <button
                className="text-xs bg-emerald-800/60 hover:bg-emerald-700/70 text-emerald-300 px-2.5 py-1 rounded"
                onClick={() => onApprove(job.id)}
              >
                Approve →
              </button>
            )}
            <button
              data-testid="drawer-edit-toggle"
              className={`text-xs px-2.5 py-1 rounded border ${
                editMode
                  ? "border-emerald-600 text-emerald-300 bg-emerald-900/30"
                  : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
              }`}
              onClick={onToggleEdit}
            >
              {editMode ? "Editing" : "Edit"}
            </button>
            <button className="text-zinc-500 text-sm hover:text-zinc-300" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Description */}
          {job.description && (
            <section>
              <SectionHeading>Job Description</SectionHeading>
              <div
                className="text-sm text-zinc-300 prose prose-invert prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: mdToHtml(job.description) }}
              />
            </section>
          )}

          {/* Resume */}
          {(hasResume || editMode) && (
            <section>
              <div className="flex items-center justify-between mb-1">
                <SectionHeading>Tailored Resume</SectionHeading>
                <div className="flex gap-2">
                  {hasResume && (
                    <a
                      href={`/api/jobs/${job.id}/pdf?type=resume`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-blue-400 hover:underline"
                      data-testid="resume-pdf-link"
                    >
                      Download PDF ↓
                    </a>
                  )}
                </div>
              </div>
              {editMode ? (
                <div>
                  <textarea
                    data-testid="resume-editor"
                    className="w-full h-72 bg-zinc-900 border border-zinc-700 rounded p-2 text-sm text-zinc-200 font-mono resize-y focus:outline-none focus:border-zinc-500"
                    value={resumeDraft}
                    onChange={(e) => setResumeDraft(e.target.value)}
                  />
                  <button
                    data-testid="resume-save"
                    className="mt-1 text-xs bg-emerald-800/60 hover:bg-emerald-700/70 text-emerald-300 px-3 py-1 rounded"
                    onClick={saveResume}
                  >
                    Save Resume
                  </button>
                </div>
              ) : (
                <iframe
                  src={`/api/jobs/${job.id}/pdf?type=resume`}
                  className="w-full rounded border border-zinc-700"
                  style={{ height: "70vh" }}
                  title="Tailored Resume PDF"
                />
              )}
            </section>
          )}

          {/* Cover Letter */}
          {(job.cover_letter_md || editMode) && (
            <section>
              <div className="flex items-center justify-between mb-1">
                <SectionHeading>Cover Letter</SectionHeading>
                {job.cover_letter_md && !editMode && (
                  <button
                    data-testid="cover-letter-copy"
                    className="text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 px-2 py-0.5 rounded"
                    onClick={() => navigator.clipboard.writeText(job.cover_letter_md ?? "")}
                  >
                    Copy
                  </button>
                )}
              </div>
              {editMode ? (
                <div>
                  <textarea
                    data-testid="cover-letter-editor"
                    className="w-full h-56 bg-zinc-900 border border-zinc-700 rounded p-2 text-sm text-zinc-200 font-mono resize-y focus:outline-none focus:border-zinc-500"
                    value={coverLetterDraft}
                    onChange={(e) => setCoverLetterDraft(e.target.value)}
                  />
                  <button
                    data-testid="cover-letter-save"
                    className="mt-1 text-xs bg-emerald-800/60 hover:bg-emerald-700/70 text-emerald-300 px-3 py-1 rounded"
                    onClick={saveCoverLetter}
                  >
                    Save Cover Letter
                  </button>
                </div>
              ) : (
                <pre className="text-sm text-zinc-300 whitespace-pre-wrap font-sans">{job.cover_letter_md}</pre>
              )}
            </section>
          )}

          {/* Notes */}
          {job.notes && (
            <section>
              <SectionHeading>Notes</SectionHeading>
              <p className="text-sm text-zinc-400 whitespace-pre-wrap">{job.notes}</p>
            </section>
          )}

          {/* Match explanation */}
          {job.match_explanation && (
            <section>
              <SectionHeading>Match Explanation</SectionHeading>
              <p className="text-sm text-zinc-400 whitespace-pre-wrap">{job.match_explanation}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs uppercase tracking-wide text-zinc-500 mb-2">{children}</h2>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-3 w-3 text-amber-400"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
