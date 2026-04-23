/**
 * Integration test for Lever and Ashby adapters.
 * Uses real low-score rejected jobs from the DB.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { applyLever } from "./adapters/lever";
import { applyAshby } from "./adapters/ashby";
import type { SubmitInput } from "./types";

const FAKE_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n190\n%%EOF",
);

const PROFILE = {
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
};

async function testLever() {
  console.log("\n=== Testing Lever adapter ===");
  const input: SubmitInput = {
    jobId: 17836,
    url: "https://jobs.lever.co/mistral/2a357282-9d44-4b41-a249-c75ffe878ce2",
    atsSource: "lever",
    profile: PROFILE,
    questions: [],
  };
  console.log("URL:", input.url);
  try {
    const result = await applyLever(input);
    console.log("Result:", JSON.stringify(result, null, 2));
  } catch (e) {
    console.error("Error:", (e as Error).message);
  }
}

async function testAshby() {
  console.log("\n=== Testing Ashby adapter ===");
  const input: SubmitInput = {
    jobId: 17311,
    url: "https://jobs.ashbyhq.com/permitflow/62135ab3-8e10-4891-a3f5-38362e1fbf15",
    atsSource: "ashby",
    profile: PROFILE,
    questions: [],
  };
  console.log("URL:", input.url);
  try {
    const result = await applyAshby(input);
    console.log("Result:", JSON.stringify(result, null, 2));
  } catch (e) {
    console.error("Error:", (e as Error).message);
  }
}

async function main() {
  mkdirSync("/tmp/spore-submit-test", { recursive: true });
  writeFileSync("/tmp/spore-submit-test/resume.pdf", FAKE_PDF);
  await testLever();
  await testAshby();
}

main();
