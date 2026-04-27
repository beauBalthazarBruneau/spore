"use client";

import { useState } from "react";
import type { PipelineRun } from "@/lib/db";

const STAGE_LABELS: Record<PipelineRun["stage"], string> = {
  "discover-companies": "1. Discover companies",
  "discover-jobs": "2. Discover jobs",
  "prescore": "3. Prescore",
  "score-jobs": "4. Score jobs",
};

const ALL_STAGES = Object.keys(STAGE_LABELS) as PipelineRun["stage"][];

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export default function RunsTable({ runs }: { runs: PipelineRun[] }) {
  const [filter, setFilter] = useState<PipelineRun["stage"] | "">("");

  const filtered = filter ? runs.filter((r) => r.stage === filter) : runs;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-zinc-700 text-zinc-400 text-left">
          <th className="py-2 pr-6 font-medium whitespace-nowrap">Time</th>
          <th className="py-2 pr-6 font-medium whitespace-nowrap">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as PipelineRun["stage"] | "")}
              className="bg-transparent text-zinc-400 font-medium text-sm cursor-pointer hover:text-zinc-200 focus:outline-none"
            >
              <option value="">Stage</option>
              {ALL_STAGES.map((stage) => (
                <option key={stage} value={stage}>{STAGE_LABELS[stage]}</option>
              ))}
            </select>
          </th>
          <th className="py-2 pr-6 font-medium whitespace-nowrap">Tokens in</th>
          <th className="py-2 pr-6 font-medium whitespace-nowrap">Tokens out</th>
          <th className="py-2 font-medium">Details</th>
        </tr>
      </thead>
      <tbody>
        {filtered.map((run, i) => (
          <tr key={i} className="border-b border-zinc-800">
            <td className="py-2 pr-6 text-zinc-400 tabular-nums whitespace-nowrap">
              {formatTimestamp(run.timestamp)}
            </td>
            <td className="py-2 pr-6 text-zinc-300 whitespace-nowrap">
              {STAGE_LABELS[run.stage]}
            </td>
            <td className="py-2 pr-6 tabular-nums whitespace-nowrap">
              {run.input_tokens != null ? (
                <span>{run.input_tokens.toLocaleString()}</span>
              ) : (
                <span className="text-zinc-600">—</span>
              )}
            </td>
            <td className="py-2 pr-6 tabular-nums whitespace-nowrap">
              {run.output_tokens != null ? (
                <span>{run.output_tokens.toLocaleString()}</span>
              ) : (
                <span className="text-zinc-600">—</span>
              )}
            </td>
            <td className="py-2 text-zinc-400">
              {Object.entries(run.summary).map(([k, v]) => (
                <span key={k} className="mr-4 whitespace-nowrap">
                  <span className="text-zinc-500">{k.replace(/_/g, " ")}</span>{" "}
                  <span className="text-zinc-200 tabular-nums">{v}</span>
                </span>
              ))}
            </td>
          </tr>
        ))}
        {filtered.length === 0 && (
          <tr>
            <td colSpan={5} className="py-4 text-zinc-500 text-center">No runs for the selected stage</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
