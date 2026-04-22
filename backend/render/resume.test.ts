import { describe, it, expect } from "vitest";
import { jsonToHtml, renderResumePdf } from "./resume";
import type { ResumeJson } from "./schema";

const fixture: ResumeJson = {
  name: "Jane Smith",
  contact: { email: "jane@example.com", location: "New York, NY" },
  summary: "Product manager with 8 years experience.",
  experience: [
    {
      company: "Acme",
      title: "PM",
      dates: "2020–present",
      bullets: ["Led team of 5", "Shipped 3 products"],
    },
  ],
  education: [{ institution: "MIT", degree: "BS Computer Science", dates: "2016" }],
  skills: { Tools: ["Figma", "Jira"] },
};

describe("jsonToHtml", () => {
  it("produces a string containing the candidate name", () => {
    const html = jsonToHtml(fixture);
    expect(typeof html).toBe("string");
    expect(html).toContain("Jane Smith");
  });

  it("contains experience company and title", () => {
    const html = jsonToHtml(fixture);
    expect(html).toContain("Acme");
    expect(html).toContain("PM");
  });

  it("contains education institution", () => {
    const html = jsonToHtml(fixture);
    expect(html).toContain("MIT");
  });

  it("contains skills", () => {
    const html = jsonToHtml(fixture);
    expect(html).toContain("Figma");
  });
});

describe("renderResumePdf", () => {
  it("produces a non-empty Buffer starting with %PDF", { timeout: 30000 }, async () => {
    const buf = await renderResumePdf(fixture);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.toString("ascii", 0, 4)).toBe("%PDF");
  });
});
