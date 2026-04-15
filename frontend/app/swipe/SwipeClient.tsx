"use client";
import { useEffect, useState, useCallback } from "react";
import type { Job } from "@/lib/types";

const REJECT_REASONS = [
  "wrong_location", "salary_too_low", "role_mismatch",
  "posting_not_found", "other",
];

export default function SwipeClient({ initialJobs }: { initialJobs: Job[] }) {
  const [queue, setQueue] = useState(initialJobs);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const current = queue[0];

  const act = useCallback(async (id: number, patch: Record<string, unknown>) => {
    setQueue((q) => q.filter((j) => j.id !== id));
    await fetch(`/api/jobs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }, []);

  useEffect(() => {
    if (rejectingId != null) return;
    const onKey = (e: KeyboardEvent) => {
      if (!current) return;
      if (e.key === "ArrowRight") act(current.id, { status: "approved" });
      else if (e.key === "ArrowLeft") setRejectingId(current.id);
      else if (e.key === "ArrowUp") act(current.id, { status: "skipped" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, act, rejectingId]);

  if (!current) {
    return (
      <div className="p-10 text-center text-zinc-400">
        <p className="text-xl">No new jobs to review.</p>
        <p className="text-sm mt-2">Run the Find Jobs agent to discover more.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="text-xs text-zinc-500 mb-2">{queue.length} to review · ← reject · → approve · ↑ skip</div>
      <article className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl">
        <header className="mb-4">
          <h1 className="text-2xl font-semibold">{current.title}</h1>
          <div className="text-zinc-400">{current.company}</div>
          <div className="text-sm text-zinc-500 flex gap-3 mt-1">
            {current.location && <span>{current.location}</span>}
            {current.salary_range && <span>· {current.salary_range}</span>}
            {current.score != null && <span>· match {current.score}</span>}
          </div>
        </header>
        {current.match_explanation && (
          <p className="text-sm text-zinc-300 italic mb-3">{current.match_explanation}</p>
        )}
        <pre className="whitespace-pre-wrap text-sm text-zinc-300 max-h-[48vh] overflow-auto">
          {(current.description ?? "").slice(0, 2000)}
        </pre>
        {current.url && (
          <a href={current.url} target="_blank" rel="noreferrer" className="text-xs text-blue-400 mt-3 inline-block">
            source ↗
          </a>
        )}
      </article>

      <div className="flex justify-between mt-6">
        <button
          className="px-5 py-2 rounded-lg bg-red-600 hover:bg-red-500"
          onClick={() => setRejectingId(current.id)}
        >← Reject</button>
        <button
          className="px-5 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600"
          onClick={() => act(current.id, { status: "skipped" })}
        >↑ Skip</button>
        <button
          className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500"
          onClick={() => act(current.id, { status: "approved" })}
        >Approve →</button>
      </div>

      {rejectingId != null && (
        <RejectModal
          onCancel={() => setRejectingId(null)}
          onSubmit={(reason, note) => {
            act(rejectingId, { status: "rejected", rejection_reason: reason, rejection_note: note || null });
            setRejectingId(null);
          }}
        />
      )}
    </div>
  );
}

function RejectModal({
  onCancel, onSubmit,
}: { onCancel: () => void; onSubmit: (reason: string, note: string) => void }) {
  const [reason, setReason] = useState(REJECT_REASONS[0]);
  const [note, setNote] = useState("");
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center" onClick={onCancel}>
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-3">Why reject?</h2>
        <select
          className="w-full bg-zinc-800 rounded p-2 mb-3"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        >
          {REJECT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <textarea
          className="w-full bg-zinc-800 rounded p-2 mb-3"
          placeholder="optional note"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <button className="px-3 py-1.5 rounded bg-zinc-700" onClick={onCancel}>Cancel</button>
          <button className="px-3 py-1.5 rounded bg-red-600" onClick={() => onSubmit(reason, note)}>Reject</button>
        </div>
      </div>
    </div>
  );
}
