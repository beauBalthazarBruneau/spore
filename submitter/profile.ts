import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "better-sqlite3";
import type { ApplicantProfile } from "./types";

type ProfileRow = {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  links_json: string | null;
  preferences_json: string | null;
};

type JobRow = {
  resume_pdf: Buffer | null;
  cover_letter_pdf: Buffer | null;
};

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  const lastName = parts[parts.length - 1];
  const firstName = parts.slice(0, -1).join(" ");
  return { firstName, lastName };
}

function parseLocation(location: string): { city: string; state: string; country: string } {
  // Expect "City, State, Country" or "City, State" or just "City"
  const parts = location.split(",").map((s) => s.trim());
  if (parts.length >= 3) return { city: parts[0], state: parts[1], country: parts[2] };
  if (parts.length === 2) return { city: parts[0], state: parts[1], country: "" };
  return { city: location, state: "", country: "" };
}

function parseLinks(linksJson: string | null): {
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
} {
  if (!linksJson) return { linkedinUrl: null, githubUrl: null, portfolioUrl: null };
  let links: Record<string, string>;
  try {
    links = JSON.parse(linksJson);
  } catch {
    return { linkedinUrl: null, githubUrl: null, portfolioUrl: null };
  }

  const find = (...keys: string[]) => {
    for (const key of keys) {
      const match = Object.entries(links).find(([k]) => k.toLowerCase().includes(key.toLowerCase()));
      if (match) return match[1];
    }
    return null;
  };

  return {
    linkedinUrl: find("linkedin"),
    githubUrl: find("github"),
    portfolioUrl: find("portfolio", "website", "personal"),
  };
}

/**
 * Resolve the applicant profile from DB, write PDF blobs to temp files, and return paths.
 * Caller is responsible for cleaning up tmpDir in a finally block.
 */
export async function resolveProfile(
  db: Database,
  jobId: number,
): Promise<{ profile: ApplicantProfile; tmpDir: string }> {
  const profileRow = db.prepare(`SELECT full_name, email, phone, location, links_json FROM profile WHERE id = 1`).get() as ProfileRow | undefined;
  if (!profileRow) throw new Error("Profile not set up — run profile onboarding before submitting");

  const jobRow = db.prepare(`SELECT resume_pdf, cover_letter_pdf FROM jobs WHERE id = ?`).get(jobId) as JobRow | undefined;
  if (!jobRow) throw new Error(`Job ${jobId} not found`);
  if (!jobRow.resume_pdf) throw new Error(`Job ${jobId} has no resume PDF — complete tailoring before submitting`);

  const fullName = profileRow.full_name ?? "";
  const { firstName, lastName } = splitName(fullName);
  const location = profileRow.location ?? "";
  const { city, state, country } = parseLocation(location);
  const { linkedinUrl, githubUrl, portfolioUrl } = parseLinks(profileRow.links_json);

  const tmpDir = `/tmp/spore-submit-${jobId}`;
  mkdirSync(tmpDir, { recursive: true });

  const resumePdfPath = join(tmpDir, "resume.pdf");
  writeFileSync(resumePdfPath, jobRow.resume_pdf);

  let coverLetterPdfPath: string | null = null;
  if (jobRow.cover_letter_pdf) {
    coverLetterPdfPath = join(tmpDir, "cover-letter.pdf");
    writeFileSync(coverLetterPdfPath, jobRow.cover_letter_pdf);
  }

  const profile: ApplicantProfile = {
    fullName,
    firstName,
    lastName,
    email: profileRow.email ?? "",
    phone: profileRow.phone ?? "",
    location,
    city,
    state,
    country,
    linkedinUrl,
    githubUrl,
    portfolioUrl,
    resumePdfPath,
    coverLetterPdfPath,
  };

  return { profile, tmpDir };
}
