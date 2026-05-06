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

  // SPORE-54: hybrid location support
  const hybridCriteria = { locations: ["New York, NY", "Remote"], remote_pref: "hybrid" };

  it("passes standalone 'Hybrid' (no city) when remote_pref is hybrid", () => {
    expect(applyHardFilters({ ...base, location: "Hybrid" }, hybridCriteria).passed).toBe(true);
  });

  it("passes 'Hybrid; In-Office' (no city) when remote_pref is hybrid", () => {
    expect(applyHardFilters({ ...base, location: "Hybrid; In-Office" }, hybridCriteria).passed).toBe(true);
  });

  it("passes 'Distributed; Hybrid' (no city) when remote_pref is hybrid", () => {
    expect(applyHardFilters({ ...base, location: "Distributed; Hybrid" }, hybridCriteria).passed).toBe(true);
  });

  it("passes 'Hybrid - New York' when remote_pref is hybrid", () => {
    expect(applyHardFilters({ ...base, location: "Hybrid - New York" }, hybridCriteria).passed).toBe(true);
  });

  it("rejects 'Hybrid - San Francisco' when remote_pref is hybrid", () => {
    const r = applyHardFilters({ ...base, location: "Hybrid - San Francisco" }, hybridCriteria);
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/not in accepted locations/);
  });

  it("rejects 'Hybrid - London' when remote_pref is hybrid", () => {
    expect(applyHardFilters({ ...base, location: "Hybrid - London" }, hybridCriteria).passed).toBe(false);
  });

  it("rejects 'Hybrid - Palo Alto, CA' when remote_pref is hybrid", () => {
    expect(applyHardFilters({ ...base, location: "Hybrid - Palo Alto, CA" }, hybridCriteria).passed).toBe(false);
  });

  it("rejects standalone 'Hybrid' when remote_pref is onsite", () => {
    const criteria = { ...hybridCriteria, remote_pref: "onsite" };
    expect(applyHardFilters({ ...base, location: "Hybrid" }, criteria).passed).toBe(false);
  });

  it("passes 'Hybrid' when remote_pref is remote", () => {
    const criteria = { ...hybridCriteria, remote_pref: "remote" };
    expect(applyHardFilters({ ...base, location: "Hybrid" }, criteria).passed).toBe(true);
  });

  // SPORE-54: broad US location strings
  const broadUSLocations = [
    "United States",
    "United States of America",
    "US",
    "USA",
    "North America",
  ];

  for (const loc of broadUSLocations) {
    it(`passes '${loc}' when remote_pref is hybrid`, () => {
      const r = applyHardFilters(
        { ...base, location: loc },
        { locations: ["New York, NY", "Remote"], remote_pref: "hybrid" },
      );
      expect(r.passed).toBe(true);
    });
  }

  it("rejects 'United States' when remote_pref is onsite", () => {
    const r = applyHardFilters(
      { ...base, location: "United States" },
      { locations: ["New York, NY", "Remote"], remote_pref: "onsite" },
    );
    expect(r.passed).toBe(false);
  });

  it("rejects when description contains an excluded description keyword", () => {
    const r = applyHardFilters(
      { ...base, description: "This role requires security clearance required to work on classified programs." },
      { exclusions: { description_keywords: ["security clearance"] } },
    );
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/description excluded keyword/);
  });

  // SPORE-58: seniority and function title exclusions
  const seniorityExclusions = {
    exclusions: {
      title_keywords: [
        "product marketing",
        "staff product manager",
        "group product manager",
        "vp of product",
        "vice president of product",
        "vice president, product",
      ],
    },
  };

  it("rejects 'Product Marketing Manager' via product marketing exclusion", () => {
    const r = applyHardFilters({ ...base, title: "Product Marketing Manager" }, seniorityExclusions);
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/title excluded keyword/);
  });

  it("rejects 'Senior Product Marketing Manager' via product marketing exclusion", () => {
    const r = applyHardFilters({ ...base, title: "Senior Product Marketing Manager" }, seniorityExclusions);
    expect(r.passed).toBe(false);
  });

  it("rejects 'Staff Product Manager' via staff exclusion", () => {
    const r = applyHardFilters({ ...base, title: "Staff Product Manager, Platform" }, seniorityExclusions);
    expect(r.passed).toBe(false);
  });

  it("rejects 'Group Product Manager' via group exclusion", () => {
    const r = applyHardFilters({ ...base, title: "Group Product Manager, Customer Interfaces" }, seniorityExclusions);
    expect(r.passed).toBe(false);
  });

  it("rejects 'VP of Product' via vp exclusion", () => {
    const r = applyHardFilters({ ...base, title: "VP of Product" }, seniorityExclusions);
    expect(r.passed).toBe(false);
  });

  it("rejects 'Vice President of Product' via vice president exclusion", () => {
    const r = applyHardFilters({ ...base, title: "Vice President of Product" }, seniorityExclusions);
    expect(r.passed).toBe(false);
  });

  it("rejects 'Vice President, Product' via vice president exclusion", () => {
    const r = applyHardFilters({ ...base, title: "Vice President, Product" }, seniorityExclusions);
    expect(r.passed).toBe(false);
  });

  it("does not reject plain 'Product Manager' via seniority exclusions", () => {
    const r = applyHardFilters({ ...base, title: "Product Manager" }, seniorityExclusions);
    expect(r.passed).toBe(true);
  });

  it("does not reject 'Senior Product Manager' via seniority exclusions", () => {
    const r = applyHardFilters({ ...base, title: "Senior Product Manager" }, seniorityExclusions);
    expect(r.passed).toBe(true);
  });

  it("title keyword matching is case-insensitive", () => {
    const r = applyHardFilters({ ...base, title: "VP OF PRODUCT" }, seniorityExclusions);
    expect(r.passed).toBe(false);
  });

  it("rejected postings have a non-null, non-empty reason string", () => {
    const r = applyHardFilters(base, { exclusions: { companies: ["acme"] } });
    expect(r.passed).toBe(false);
    expect(typeof r.reason).toBe("string");
    expect(r.reason!.length).toBeGreaterThan(0);
  });

  it("passing postings have passed: true and no rejection reason", () => {
    const r = applyHardFilters(base, {});
    expect(r.passed).toBe(true);
    expect(r.reason).toBeUndefined();
  });
});
