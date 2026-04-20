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

  it("passes remote roles when locations include Remote", () => {
    const r = applyHardFilters(
      { ...base, location: "Remote", remote: "remote" },
      { locations: ["New York, NY", "Remote"] },
    );
    expect(r.passed).toBe(true);
  });

  it("passes roles in an accepted location", () => {
    const r = applyHardFilters(
      { ...base, location: "New York, NY" },
      { locations: ["New York, NY", "Remote"] },
    );
    expect(r.passed).toBe(true);
  });

  it("rejects roles in a non-accepted location", () => {
    const r = applyHardFilters(
      { ...base, location: "San Francisco, CA", remote: "onsite" },
      { locations: ["New York, NY", "Remote"] },
    );
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/not in accepted locations/);
  });

  it("passes when location contains accepted city", () => {
    const r = applyHardFilters(
      { ...base, location: "New York, NY; San Francisco, CA" },
      { locations: ["New York, NY", "Remote"] },
    );
    expect(r.passed).toBe(true);
  });

  it("passes when remote signal is in location string", () => {
    const r = applyHardFilters(
      { ...base, location: "Remote (US)" },
      { locations: ["New York, NY", "Remote"] },
    );
    expect(r.passed).toBe(true);
  });

  it("matches NYC variants against 'New York, NY'", () => {
    const locs = ["New York, NY", "Remote"];
    for (const nyc of ["New York City, NY", "New York, New York", "New York City", "Hybrid - New York City", "New York"]) {
      const r = applyHardFilters({ ...base, location: nyc, remote: undefined }, { locations: locs });
      expect(r.passed, `expected '${nyc}' to pass`).toBe(true);
    }
  });

  it("skips location filter when no locations configured", () => {
    const r = applyHardFilters(
      { ...base, location: "Tokyo, Japan" },
      {},
    );
    expect(r.passed).toBe(true);
  });
});
