/**
 * Manual integration test for the Greenhouse adapter.
 * Uses a real low-score rejected job from the DB.
 * Run: npx tsx submitter/test-greenhouse.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { applyGreenhouse } from "./adapters/greenhouse";
import type { SubmitInput } from "./types";

// Minimal fake PDF for testing (1-page valid PDF header)
const FAKE_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n190\n%%EOF",
);

async function main() {
  mkdirSync("/tmp/spore-submit-test", { recursive: true });
  writeFileSync("/tmp/spore-submit-test/resume.pdf", FAKE_PDF);

  const input: SubmitInput = {
    jobId: 14249,
    url: "https://job-boards.greenhouse.io/anthropic/jobs/5165641008",
    atsSource: "greenhouse",
    profile: {
      fullName: "Beau Bruneau",
      firstName: "Beau",
      lastName: "Bruneau",
      email: "beauroccobruneau@gmail.com",
      phone: "555-555-5555",
      location: "San Francisco, CA, USA",
      city: "San Francisco",
      state: "CA",
      country: "United States",
      linkedinUrl: "https://linkedin.com/in/beaubruneau",
      githubUrl: "https://github.com/beaubalthazarbruneau",
      portfolioUrl: null,
      resumePdfPath: "/tmp/spore-submit-test/resume.pdf",
      coverLetterPdfPath: null,
    },
    questions: [],
  };

  console.log("Testing Greenhouse adapter against:", input.url);
  console.log("Note: This is a rejected low-score job used only for adapter testing.\n");

  try {
    const result = await applyGreenhouse(input);
    console.log("Result:", JSON.stringify(result, null, 2));
  } catch (e) {
    console.error("Error:", (e as Error).message);
  }
}

main();
