export type JobStatus =
  | "fetched"
  | "new" | "approved" | "rejected" | "skipped"
  | "needs_tailoring" | "tailoring" | "tailored" | "ready_to_apply"
  | "applied" | "interview_invite" | "declined" | "on_hold";

export const SWIPE_STATUS: JobStatus = "new";
export const BOARD_COLUMNS: JobStatus[] = [
  "fetched", "new", "needs_tailoring", "tailoring", "tailored", "ready_to_apply", "applied", "interview_invite",
];
export const BOARD_SIDE: JobStatus[] = ["declined", "on_hold"];

export type Job = {
  id: number;
  title: string;
  company: string;
  location: string | null;
  salary_range: string | null;
  url: string | null;
  source: string | null;
  description: string | null;
  score: number | null;
  match_explanation: string | null;
  status: JobStatus;
  rejection_reason: string | null;
  rejection_note: string | null;
  notes: string | null;
  resume_tex: string | null;
  cover_letter_md: string | null;
  submitted_at: string | null;
  discovered_at: string;
  updated_at: string;
};
