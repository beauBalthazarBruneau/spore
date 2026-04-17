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
});
