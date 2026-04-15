"use client";
import { useMemo, useState } from "react";
import { DndContext, DragEndEvent, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
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
  approved: "", rejected: "", skipped: "",
};

export default function BoardClient({ initialJobs }: { initialJobs: Job[] }) {
  const [jobs, setJobs] = useState(initialJobs);
  const [selected, setSelected] = useState<Job | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const byStatus = useMemo(() => {
    const m: Record<string, Job[]> = {};
    for (const j of jobs) (m[j.status] ??= []).push(j);
    return m;
  }, [jobs]);

  async function onDragEnd(e: DragEndEvent) {
    const jobId = Number(e.active.id);
    const target = e.over?.id as JobStatus | undefined;
    if (!target) return;
    const job = jobs.find((j) => j.id === jobId);
    if (!job || job.status === target) return;
    setJobs((all) => all.map((j) => (j.id === jobId ? { ...j, status: target } : j)));
    await fetch(`/api/jobs/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: target }),
    });
  }

  return (
    <div className="p-4">
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {BOARD_COLUMNS.map((col) => (
            <Column key={col} status={col} jobs={byStatus[col] ?? []} onOpen={setSelected} />
          ))}
        </div>
        <div className="flex gap-3 mt-4 opacity-70">
          {BOARD_SIDE.map((col) => (
            <Column key={col} status={col} jobs={byStatus[col] ?? []} onOpen={setSelected} compact />
          ))}
        </div>
      </DndContext>
      {selected && <Drawer job={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Column({ status, jobs, onOpen, compact }: {
  status: JobStatus; jobs: Job[]; onOpen: (j: Job) => void; compact?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={`flex-1 min-w-[220px] rounded-lg border border-zinc-800 bg-zinc-900/40 ${isOver ? "ring-2 ring-emerald-500" : ""}`}
    >
      <div className="px-3 py-2 border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-400 flex justify-between">
        <span>{COLUMN_LABELS[status]}</span><span>{jobs.length}</span>
      </div>
      <div className={`p-2 space-y-2 ${compact ? "max-h-32 overflow-auto" : "min-h-[60vh]"}`}>
        {jobs.map((j) => <Card key={j.id} job={j} onOpen={onOpen} />)}
      </div>
    </div>
  );
}

function Card({ job, onOpen }: { job: Job; onOpen: (j: Job) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: String(job.id) });
  return (
    <div
      ref={setNodeRef}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={`rounded-md bg-zinc-900 border border-zinc-800 p-2 cursor-grab active:cursor-grabbing ${isDragging ? "opacity-60" : ""}`}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(job)}
    >
      <div className="text-sm font-medium">{job.title}</div>
      <div className="text-xs text-zinc-400">{job.company}</div>
      {job.location && <div className="text-[11px] text-zinc-500 mt-0.5">{job.location}</div>}
    </div>
  );
}

function Drawer({ job, onClose }: { job: Job; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex justify-end" onClick={onClose}>
      <div
        className="w-full max-w-xl h-full bg-zinc-950 border-l border-zinc-800 p-6 overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="text-zinc-500 text-sm mb-4" onClick={onClose}>close ✕</button>
        <h1 className="text-xl font-semibold">{job.title}</h1>
        <div className="text-zinc-400">{job.company}</div>
        <div className="text-xs text-zinc-500 mt-1">
          {job.location} · {job.salary_range ?? "—"} · status: {job.status}
        </div>
        {job.url && <a className="text-xs text-blue-400" href={job.url} target="_blank" rel="noreferrer">source ↗</a>}
        <Section title="Description">{job.description}</Section>
        <Section title="Tailored Resume (TeX)">{job.resume_tex}</Section>
        <Section title="Cover Letter">{job.cover_letter_md}</Section>
        <Section title="Notes">{job.notes}</Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: any }) {
  if (!children) return null;
  return (
    <section className="mt-5">
      <h2 className="text-xs uppercase tracking-wide text-zinc-500 mb-1">{title}</h2>
      <pre className="whitespace-pre-wrap text-sm text-zinc-300">{children}</pre>
    </section>
  );
}
