import { describe, it, expect } from "vitest";
import { applyHardFilters } from "./filters";
import type { RawPosting } from "./sources/types";

const base: RawPosting = {
  source: "greenhouse",
  source_job_id: "1",
  url: "https://example.com/jobs/1",
  title: "Senior Software Engineer",
  company_name: "Acme",
  location: "Remote (US)",
  description: "Build things.",
  raw: {},
};

describe("applyHardFilters", () => {
  it("passes when no exclusions match", () => {
    expect(applyHardFilters(base, {}).passed).toBe(true);
  });

  it("rejects excluded companies (case-insensitive)", () => {
    const r = applyHardFilters(base, { exclusions: { companies: ["acme"] } });
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/excluded company/);
  });

  it("rejects title keyword matches", () => {
    const r = applyHardFilters({ ...base, title: "Staff Manager" }, {
      exclusions: { title_keywords: ["manager"] },
    });
    expect(r.passed).toBe(false);
  });

  it("rejects when salary_max is below the floor", () => {
    const r = applyHardFilters({ ...base, salary_max: 90_000 }, { salary_min: 150_000 });
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/below floor/);
  });

  it("allows missing salary_max even when a floor is set", () => {
    expect(applyHardFilters(base, { salary_min: 200_000 }).passed).toBe(true);
  });

  it("rejects on-site-only postings when remote is required", () => {
    const r = applyHardFilters(
      { ...base, location: "New York, NY", description: "This role is on-site only." },
      { remote_pref: "remote" },
    );
    expect(r.passed).toBe(false);
  });
});
