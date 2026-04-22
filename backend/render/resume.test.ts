import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { jsonToTex, renderResumePdf } from "./resume";
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

describe("jsonToTex", () => {
  it("produces a string containing \\documentclass", () => {
    const tex = jsonToTex(fixture);
    expect(typeof tex).toBe("string");
    expect(tex).toContain("\\documentclass");
  });

  it("contains the candidate name", () => {
    const tex = jsonToTex(fixture);
    expect(tex).toContain("Jane Smith");
  });

  it("contains experience company and title", () => {
    const tex = jsonToTex(fixture);
    expect(tex).toContain("Acme");
    expect(tex).toContain("PM");
  });

  it("contains education institution", () => {
    const tex = jsonToTex(fixture);
    expect(tex).toContain("MIT");
  });

  it("contains skills", () => {
    const tex = jsonToTex(fixture);
    expect(tex).toContain("Figma");
  });
});

// Skip renderResumePdf integration test if pdflatex is not installed
let hasPdflatex = false;
try {
  execSync("which pdflatex", { stdio: "ignore" });
  hasPdflatex = true;
} catch {
  hasPdflatex = false;
}

describe("renderResumePdf", () => {
  const itMaybe = hasPdflatex ? it : it.skip;

  itMaybe("produces a non-empty Buffer starting with %PDF", { timeout: 30_000 }, async () => {
    const buf = await renderResumePdf(fixture);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.toString("ascii", 0, 4)).toBe("%PDF");
  });
});
