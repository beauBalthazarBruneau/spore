import { describe, it, expect } from "vitest";
import { titleMatch, keywordsMatch, seniorityScore, compSignal, recencyScore, computePrescore, tokenize } from "./prescore";

describe("tokenize", () => {
  it("lowercases, removes short words and stop words", () => {
    const tokens = tokenize("Senior Backend Engineer at Acme");
    expect(tokens).toEqual(new Set(["senior", "backend", "engineer", "acme"]));
  });
});

describe("titleMatch", () => {
  it("returns 40 for exact match", () => {
    expect(titleMatch("Senior Backend Engineer", ["Senior Backend Engineer"])).toBe(40);
  });

  it("returns partial score for partial overlap", () => {
    const score = titleMatch("Staff Platform Engineer", ["Senior Backend Engineer"]);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(40);
  });

  it("returns 0 for no overlap", () => {
    expect(titleMatch("Marketing Manager", ["Senior Backend Engineer"])).toBe(0);
  });

  it("returns 20 when no target titles configured", () => {
    expect(titleMatch("Anything", undefined)).toBe(20);
    expect(titleMatch("Anything", [])).toBe(20);
  });

  it("picks the best match across multiple targets", () => {
    const score = titleMatch("Staff Backend Engineer", ["Senior Backend Engineer", "Staff Software Engineer"]);
    expect(score).toBeGreaterThanOrEqual(27);
  });
});

describe("keywordsMatch", () => {
  it("scores based on keyword hit ratio", () => {
    expect(keywordsMatch("We use React and TypeScript daily", ["react", "typescript", "go", "rust"])).toBe(13);
  });

  it("returns 0 with no keywords or description", () => {
    expect(keywordsMatch(null, ["react"])).toBe(0);
    expect(keywordsMatch("something", undefined)).toBe(0);
  });

  it("returns 0 when criteria has 0 keywords but description is non-empty", () => {
    expect(keywordsMatch("We use React and TypeScript", [])).toBe(0);
  });

  it("returns the max keyword score (25) when all keywords match", () => {
    // 4/4 keywords hit → Math.round(25 * 4/4) = 25, capped at 25
    expect(keywordsMatch("We use react typescript postgresql graphql", ["react", "typescript", "postgresql", "graphql"])).toBe(25);
  });
});

describe("seniorityScore", () => {
  it("gives 15 for senior titles", () => {
    expect(seniorityScore("Senior Software Engineer")).toBe(15);
    expect(seniorityScore("Staff Engineer")).toBe(15);
    expect(seniorityScore("Principal Architect")).toBe(15);
  });

  it("gives 0 for junior titles", () => {
    expect(seniorityScore("Junior Developer")).toBe(0);
    expect(seniorityScore("Engineering Intern")).toBe(0);
  });

  it("gives 7 for neutral titles", () => {
    expect(seniorityScore("Software Engineer")).toBe(7);
  });
});

describe("compSignal", () => {
  it("gives 10 when salary info present", () => {
    expect(compSignal(150000, null)).toBe(10);
    expect(compSignal(null, "$150k-$200k")).toBe(10);
  });

  it("gives 0 when no salary info", () => {
    expect(compSignal(null, null)).toBe(0);
  });

  it("gives 10 when salary_min present but salary_max null", () => {
    expect(compSignal(120000, null)).toBe(10);
  });

  it("gives 10 when both salary_min and salary_range are present", () => {
    expect(compSignal(120000, "$120k-$160k")).toBe(10);
  });

  it("gives 10 when salary_range string mentions a dollar amount like $150k", () => {
    expect(compSignal(null, "$150k")).toBe(10);
  });

  it("gives 0 when salary_range is empty string and salary_min is null", () => {
    expect(compSignal(null, "")).toBe(0);
  });
});

describe("recencyScore", () => {
  it("gives 10 for recent posts", () => {
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(recencyScore(recent)).toBe(10);
  });

  it("gives 5 for 30-90 day old posts", () => {
    const older = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    expect(recencyScore(older)).toBe(5);
  });

  it("gives 0 for very old posts", () => {
    const ancient = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    expect(recencyScore(ancient)).toBe(0);
  });

  it("gives 5 for unknown dates", () => {
    expect(recencyScore(null)).toBe(5);
  });

  it("gives 5 for a posting exactly 1 day old (still within 30-day window, should be 10)", () => {
    // 1 day old is within the <=30 day window → score is 10
    const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    expect(recencyScore(oneDayAgo)).toBe(10);
  });

  it("gives 5 for a posting 31 days old (past the 30-day threshold, within 90-day band)", () => {
    // 31 days old: ageDays > 30 and <= 90 → score is 5
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    expect(recencyScore(thirtyOneDaysAgo)).toBe(5);
  });

  it("gives 5 for null posted_at (default fallback)", () => {
    expect(recencyScore(null)).toBe(5);
    expect(recencyScore(undefined)).toBe(5);
  });
});

describe("computePrescore", () => {
  it("sums all signals", () => {
    const score = computePrescore(
      {
        title: "Senior Backend Engineer",
        description: "Build APIs using TypeScript and PostgreSQL",
        posted_at: new Date().toISOString(),
        salary_min: 180000,
        salary_range: "$180k-$220k",
      },
      {
        titles: ["Senior Backend Engineer"],
        keywords: ["typescript", "postgresql", "react", "go"],
      },
    );
    expect(score).toBe(40 + 13 + 15 + 10 + 10);
  });

  it("gives a baseline even with no criteria", () => {
    const score = computePrescore(
      { title: "Software Engineer", description: null, posted_at: null, salary_min: null, salary_range: null },
      {},
    );
    expect(score).toBe(20 + 0 + 7 + 0 + 5);
  });

  it("scores ≥ 60 for a strong match: matching title, keywords, senior seniority, explicit salary, recent date", () => {
    const score = computePrescore(
      {
        title: "Senior Software Engineer",
        description: "We primarily use TypeScript, React, and PostgreSQL. Remote-friendly team.",
        posted_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        salary_min: 160000,
        salary_range: "$160k-$200k",
      },
      {
        titles: ["Senior Software Engineer"],
        keywords: ["typescript", "react", "postgresql"],
      },
    );
    expect(score).toBeGreaterThanOrEqual(60);
  });

  it("scores < 30 for a weak match: no title match, no keywords, junior seniority, no salary, 60 days old", () => {
    const score = computePrescore(
      {
        title: "Junior Marketing Coordinator",
        description: "Coordinate marketing campaigns and events.",
        posted_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
        salary_min: null,
        salary_range: null,
      },
      {
        titles: ["Senior Software Engineer"],
        keywords: ["typescript", "react", "postgresql"],
      },
    );
    expect(score).toBeLessThan(30);
  });
});
