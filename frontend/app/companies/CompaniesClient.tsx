"use client";
import { useState } from "react";
import type { CompanyRow } from "@/lib/db";

const ATS_OPTIONS = ["", "greenhouse", "lever", "ashby"];

function boardUrl(c: CompanyRow): string | null {
  if (!c.ats_source || !c.ats_slug) return null;
  if (c.ats_source === "greenhouse") return `https://boards.greenhouse.io/${c.ats_slug}`;
  if (c.ats_source === "lever") return `https://jobs.lever.co/${c.ats_slug}`;
  if (c.ats_source === "ashby") return `https://jobs.ashbyhq.com/${c.ats_slug}`;
  return null;
}

export default function CompaniesClient({ initial }: { initial: CompanyRow[] }) {
  const [rows, setRows] = useState<CompanyRow[]>(initial);
  const [showArchived, setShowArchived] = useState(false);

  async function reload(includeArchived = showArchived) {
    const res = await fetch(`/api/companies?includeArchived=${includeArchived ? 1 : 0}`);
    setRows(await res.json());
  }

  async function patch(id: number, body: Record<string, unknown>) {
    const res = await fetch(`/api/companies/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const updated = (await res.json()) as CompanyRow;
    setRows((r) => r.map((x) => (x.id === id ? updated : x)));
  }

  async function toggleArchived() {
    const next = !showArchived;
    setShowArchived(next);
    await reload(next);
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Companies</h1>
        <label className="text-sm flex items-center gap-2 text-zinc-400">
          <input type="checkbox" checked={showArchived} onChange={toggleArchived} />
          show archived
        </label>
      </div>

      <AddCompany onAdded={() => reload()} />

      <table className="w-full text-sm border border-zinc-800 rounded overflow-hidden">
        <thead className="bg-zinc-900 text-zinc-400">
          <tr>
            <th className="text-left px-3 py-2">Name</th>
            <th className="text-left px-3 py-2">ATS</th>
            <th className="text-left px-3 py-2">Slug</th>
            <th className="text-center px-3 py-2">Watch</th>
            <th className="text-right px-3 py-2">Discovered</th>
            <th className="text-right px-3 py-2">Applied</th>
            <th className="text-left px-3 py-2">Last seen</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const url = boardUrl(c);
            return (
              <tr key={c.id} className={`border-t border-zinc-800 ${c.archived ? "opacity-50" : ""}`}>
                <td className="px-3 py-2 font-medium">{c.name}</td>
                <td className="px-3 py-2">
                  <AtsCell c={c} onChange={(v) => patch(c.id, { ats_source: v || null })} />
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  <SlugCell c={c} onChange={(v) => patch(c.id, { ats_slug: v || null })} url={url} />
                </td>
                <td className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={!!c.watching}
                    disabled={!c.ats_source || !c.ats_slug}
                    onChange={(e) => patch(c.id, { watching: e.target.checked ? 1 : 0 })}
                  />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{c.jobs_discovered}</td>
                <td className="px-3 py-2 text-right tabular-nums">{c.jobs_applied}</td>
                <td className="px-3 py-2 text-xs text-zinc-500">
                  {c.last_discovered_at ? new Date(c.last_discovered_at).toLocaleDateString() : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    className="text-xs text-zinc-400 hover:text-white"
                    onClick={() => patch(c.id, { archived: c.archived ? 0 : 1 })}
                  >
                    {c.archived ? "unarchive" : "archive"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AtsCell({ c, onChange }: { c: CompanyRow; onChange: (v: string) => void }) {
  return (
    <select
      className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs"
      value={c.ats_source ?? ""}
      onChange={(e) => onChange(e.target.value)}
    >
      {ATS_OPTIONS.map((o) => (
        <option key={o} value={o}>
          {o || "—"}
        </option>
      ))}
    </select>
  );
}

function SlugCell({
  c,
  onChange,
  url,
}: {
  c: CompanyRow;
  onChange: (v: string) => void;
  url: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(c.ats_slug ?? "");
  if (editing) {
    return (
      <input
        autoFocus
        className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs w-32"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (v !== (c.ats_slug ?? "")) onChange(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setV(c.ats_slug ?? "");
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <span className="flex items-center gap-2">
      <button className="hover:text-white text-left" onClick={() => setEditing(true)}>
        {c.ats_slug ?? <span className="text-zinc-600">set…</span>}
      </button>
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="text-zinc-500 hover:text-white">
          ↗
        </a>
      )}
    </span>
  );
}

function AddCompany({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [atsSource, setAtsSource] = useState("");
  const [atsSlug, setAtsSlug] = useState("");
  const [watching, setWatching] = useState(true);
  const [status, setStatus] = useState("");
  const [test, setTest] = useState<{ ok: boolean; count?: number; error?: string } | null>(null);

  async function doTest() {
    setStatus("testing…");
    setTest(null);
    const res = await fetch("/api/companies/test-fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ats_source: atsSource, ats_slug: atsSlug }),
    });
    const body = await res.json();
    setTest(body);
    setStatus("");
  }

  async function save() {
    if (!name.trim()) {
      setStatus("name required");
      return;
    }
    setStatus("saving…");
    const res = await fetch("/api/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        ats_source: atsSource || null,
        ats_slug: atsSlug || null,
        watching: watching && atsSource && atsSlug ? 1 : 0,
      }),
    });
    if (!res.ok) {
      setStatus("error: " + (await res.text()));
      return;
    }
    setStatus("added");
    setName("");
    setAtsSlug("");
    setTest(null);
    onAdded();
  }

  return (
    <div className="border border-zinc-800 rounded p-3 mb-4 flex flex-wrap items-end gap-2">
      <div>
        <div className="text-xs text-zinc-500 mb-1">Name</div>
        <input
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tandem"
        />
      </div>
      <div>
        <div className="text-xs text-zinc-500 mb-1">ATS</div>
        <select
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-sm"
          value={atsSource}
          onChange={(e) => setAtsSource(e.target.value)}
        >
          {ATS_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o || "— none (manual)"}
            </option>
          ))}
        </select>
      </div>
      <div>
        <div className="text-xs text-zinc-500 mb-1">Slug</div>
        <input
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-sm font-mono"
          value={atsSlug}
          onChange={(e) => setAtsSlug(e.target.value)}
          placeholder="tandem"
          disabled={!atsSource}
        />
      </div>
      <label className="text-sm flex items-center gap-2 text-zinc-400">
        <input
          type="checkbox"
          checked={watching}
          disabled={!atsSource || !atsSlug}
          onChange={(e) => setWatching(e.target.checked)}
        />
        watch
      </label>
      <button
        className="px-3 py-1 bg-zinc-800 rounded text-sm disabled:opacity-40"
        onClick={doTest}
        disabled={!atsSource || !atsSlug}
      >
        Test
      </button>
      <button className="px-3 py-1 bg-emerald-600 rounded text-sm" onClick={save}>
        Add
      </button>
      <span className="text-sm text-zinc-400">{status}</span>
      {test && (
        <span className={`text-sm ${test.ok ? "text-emerald-400" : "text-red-400"}`}>
          {test.ok ? `found ${test.count} jobs` : `error: ${test.error}`}
        </span>
      )}
    </div>
  );
}
