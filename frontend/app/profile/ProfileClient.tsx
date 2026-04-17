"use client";
import { useState } from "react";
import type { Profile } from "@/lib/types";

function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [input, setInput] = useState("");

  function add() {
    const trimmed = input.trim();
    if (trimmed && !value.includes(trimmed)) onChange([...value, trimmed]);
    setInput("");
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {value.map((tag) => (
          <span key={tag} className="flex items-center gap-1 px-2 py-0.5 bg-zinc-800 rounded text-sm">
            {tag}
            <button type="button" onClick={() => onChange(value.filter((t) => t !== tag))} className="text-zinc-500 hover:text-white">&times;</button>
          </span>
        ))}
      </div>
      <input
        className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        placeholder={placeholder ?? "Type and press Enter"}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-zinc-800 rounded-lg p-5 space-y-4">
      <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wide">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

const input = "w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm";

export default function ProfileClient({ initial }: { initial: Profile | null }) {
  const [profile, setProfile] = useState<Profile>(() => initial ?? {
    full_name: null, email: null, phone: null, location: null,
    links_json: {}, base_resume_md: null, preferences_json: {},
    criteria_json: {},
  });
  const [status, setStatus] = useState("");

  function set<K extends keyof Profile>(key: K, val: Profile[K]) {
    setProfile((p) => ({ ...p, [key]: val }));
  }

  function setCriteria<K extends keyof NonNullable<Profile["criteria_json"]>>(key: K, val: NonNullable<Profile["criteria_json"]>[K]) {
    setProfile((p) => ({ ...p, criteria_json: { ...p.criteria_json, [key]: val } }));
  }

  function setExclusion<K extends keyof NonNullable<NonNullable<Profile["criteria_json"]>["exclusions"]>>(
    key: K,
    val: NonNullable<NonNullable<Profile["criteria_json"]>["exclusions"]>[K],
  ) {
    setProfile((p) => ({
      ...p,
      criteria_json: {
        ...p.criteria_json,
        exclusions: { ...p.criteria_json.exclusions, [key]: val },
      },
    }));
  }

  async function save() {
    try {
      setStatus("saving...");
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      if (!res.ok) throw new Error(await res.text());
      setStatus("saved");
      setTimeout(() => setStatus(""), 2000);
    } catch (e: any) {
      setStatus("error: " + e.message);
    }
  }

  const c = profile.criteria_json;
  const ex = c.exclusions ?? {};

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Profile</h1>
        <div className="flex items-center gap-3">
          {status && <span className="text-sm text-zinc-400">{status}</span>}
          <button className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded text-sm font-medium" onClick={save}>Save</button>
        </div>
      </div>

      <Section title="Basics">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Full name">
            <input className={input} value={profile.full_name ?? ""} onChange={(e) => set("full_name", e.target.value || null)} />
          </Field>
          <Field label="Email">
            <input className={input} type="email" value={profile.email ?? ""} onChange={(e) => set("email", e.target.value || null)} />
          </Field>
          <Field label="Phone">
            <input className={input} value={profile.phone ?? ""} onChange={(e) => set("phone", e.target.value || null)} />
          </Field>
          <Field label="Location">
            <input className={input} value={profile.location ?? ""} onChange={(e) => set("location", e.target.value || null)} placeholder="e.g. New York, NY" />
          </Field>
        </div>
      </Section>

      <Section title="Links">
        <div className="grid grid-cols-2 gap-4">
          {["linkedin", "github", "portfolio"].map((key) => (
            <Field key={key} label={key.charAt(0).toUpperCase() + key.slice(1)}>
              <input
                className={input}
                value={profile.links_json[key] ?? ""}
                onChange={(e) => {
                  const next = { ...profile.links_json };
                  if (e.target.value) next[key] = e.target.value;
                  else delete next[key];
                  set("links_json", next);
                }}
                placeholder={`https://...`}
              />
            </Field>
          ))}
        </div>
      </Section>

      <Section title="Resume">
        <Field label="Base resume (markdown)">
          <textarea
            className={`${input} h-64 font-mono`}
            value={profile.base_resume_md ?? ""}
            onChange={(e) => set("base_resume_md", e.target.value || null)}
            placeholder="Paste your resume here in markdown format..."
          />
        </Field>
      </Section>

      <Section title="Search criteria">
        <Field label="Target titles">
          <TagInput value={c.titles ?? []} onChange={(v) => setCriteria("titles", v)} placeholder="e.g. Software Engineer" />
        </Field>
        <Field label="Locations">
          <TagInput value={c.locations ?? []} onChange={(v) => setCriteria("locations", v)} placeholder="e.g. New York, NY" />
        </Field>
        <Field label="Keywords">
          <TagInput value={c.keywords ?? []} onChange={(v) => setCriteria("keywords", v)} placeholder="e.g. AI, Platform" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Minimum salary">
            <input className={input} type="number" value={c.salary_min ?? ""} onChange={(e) => setCriteria("salary_min", e.target.value ? Number(e.target.value) : undefined)} />
          </Field>
          <Field label="Remote preference">
            <select className={input} value={c.remote_pref ?? ""} onChange={(e) => setCriteria("remote_pref", e.target.value || undefined)}>
              <option value="">No preference</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">On-site</option>
            </select>
          </Field>
        </div>
      </Section>

      <Section title="Exclusions">
        <Field label="Companies">
          <TagInput value={ex.companies ?? []} onChange={(v) => setExclusion("companies", v)} placeholder="Company names to skip" />
        </Field>
        <Field label="Industries">
          <TagInput value={ex.industries ?? []} onChange={(v) => setExclusion("industries", v)} placeholder="e.g. crypto, gambling" />
        </Field>
        <Field label="Title keywords">
          <TagInput value={ex.title_keywords ?? []} onChange={(v) => setExclusion("title_keywords", v)} placeholder="e.g. intern, sales" />
        </Field>
        <Field label="Description keywords">
          <TagInput value={ex.description_keywords ?? []} onChange={(v) => setExclusion("description_keywords", v)} placeholder="e.g. security clearance" />
        </Field>
        <Field label="Seniority levels">
          <TagInput value={ex.seniority ?? []} onChange={(v) => setExclusion("seniority", v)} placeholder="e.g. junior, principal" />
        </Field>
        <div className="flex items-center gap-2 pt-1">
          <input
            type="checkbox"
            id="visa"
            checked={ex.visa_required ?? false}
            onChange={(e) => setExclusion("visa_required", e.target.checked)}
            className="rounded border-zinc-700"
          />
          <label htmlFor="visa" className="text-sm text-zinc-400">Requires visa sponsorship</label>
        </div>
      </Section>

      <Section title="Preferences">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="remote_ok"
            checked={(profile.preferences_json as any)?.remote_ok ?? false}
            onChange={(e) => set("preferences_json", { ...profile.preferences_json, remote_ok: e.target.checked })}
            className="rounded border-zinc-700"
          />
          <label htmlFor="remote_ok" className="text-sm text-zinc-400">Open to remote work</label>
        </div>
      </Section>
    </div>
  );
}
