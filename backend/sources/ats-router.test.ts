import { describe, it, expect } from "vitest";
import { parseAtsUrl } from "./ats-router";

describe("parseAtsUrl", () => {
  it("parses greenhouse boards.greenhouse.io URLs", () => {
    expect(parseAtsUrl("https://boards.greenhouse.io/acme/jobs/12345")).toEqual({
      source: "greenhouse",
      slug: "acme",
      jobId: "12345",
    });
  });

  it("parses greenhouse job-boards.greenhouse.io URLs", () => {
    expect(parseAtsUrl("https://job-boards.greenhouse.io/acme/jobs/12345")).toEqual({
      source: "greenhouse",
      slug: "acme",
      jobId: "12345",
    });
  });

  it("parses lever URLs", () => {
    const m = parseAtsUrl("https://jobs.lever.co/acme/abc123de-f456-7890-abcd-ef1234567890");
    expect(m?.source).toBe("lever");
    expect(m?.slug).toBe("acme");
  });

  it("parses ashby URLs", () => {
    const m = parseAtsUrl("https://jobs.ashbyhq.com/acme/abc123");
    expect(m?.source).toBe("ashby");
    expect(m?.slug).toBe("acme");
  });

  it("parses rippling URLs", () => {
    const m = parseAtsUrl("https://ats.rippling.com/acme/jobs/job-123");
    expect(m?.source).toBe("rippling");
    expect(m?.slug).toBe("acme");
  });

  it("accepts board-level URLs without a job id", () => {
    expect(parseAtsUrl("https://boards.greenhouse.io/acme")).toEqual({
      source: "greenhouse",
      slug: "acme",
      jobId: undefined,
    });
  });

  it("returns null for non-ATS URLs", () => {
    expect(parseAtsUrl("https://acme.com/careers/eng")).toBeNull();
    expect(parseAtsUrl("https://linkedin.com/jobs/12345")).toBeNull();
  });
});
