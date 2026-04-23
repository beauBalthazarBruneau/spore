import type { Database } from "better-sqlite3";
import type { ApplicantProfile } from "./types";

/** Resolve the applicant profile from DB, write PDF blobs to temp files, and return paths.
 *  Implemented in SPORE-42. This stub allows the scaffold to compile. */
export async function resolveProfile(
  _db: Database,
  _jobId: number,
): Promise<{ profile: ApplicantProfile; tmpDir: string }> {
  throw new Error("not implemented — see SPORE-42");
}
