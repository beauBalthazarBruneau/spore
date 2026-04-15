"use client";
import { useState } from "react";

export default function ProfileClient({ initial }: { initial: any }) {
  const [text, setText] = useState(JSON.stringify(initial, null, 2));
  const [status, setStatus] = useState("");

  async function save() {
    try {
      const body = JSON.parse(text);
      setStatus("saving…");
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      setStatus("saved ✓");
    } catch (e: any) {
      setStatus("error: " + e.message);
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-xl font-semibold mb-3">Profile</h1>
      <p className="text-sm text-zinc-500 mb-3">Raw JSON edit for now. Structured form later.</p>
      <textarea
        className="w-full h-[60vh] bg-zinc-900 border border-zinc-800 rounded p-3 font-mono text-sm"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex items-center gap-3 mt-3">
        <button className="px-4 py-2 bg-emerald-600 rounded" onClick={save}>Save</button>
        <span className="text-sm text-zinc-400">{status}</span>
      </div>
    </div>
  );
}
