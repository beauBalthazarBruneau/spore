export type Profile = {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  links_json: Record<string, string>;
  base_resume_md: string | null;
  preferences_json: Record<string, unknown>;
  criteria_json: {
    titles?: string[];
    locations?: string[];
    keywords?: string[];
    exclusions?: {
      companies?: string[];
      company_domains?: string[];
      title_keywords?: string[];
      description_keywords?: string[];
      industries?: string[];
      locations?: string[];
      seniority?: string[];
      visa_required?: boolean;
    };
    salary_min?: number;
    remote_pref?: string;
  };
};

export type JobStatus =
  | "fetched"
  | "new" | "approved" | "rejected" | "skipped"
  | "needs_tailoring" | "tailoring" | "tailored" | "ready_to_apply"
  | "applied" | "interview_invite" | "declined" | "on_hold"
  | "submitting" | "submission_failed";

export const SWIPE_STATUS: JobStatus = "new";
export const BOARD_COLUMNS: JobStatus[] = [
  "fetched", "new", "needs_tailoring", "tailoring", "tailored", "ready_to_apply", "applied", "interview_invite",
];
export const BOARD_SIDE: JobStatus[] = ["declined", "on_hold", "submission_failed"];

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
  approval_reason: string | null;
  approval_note: string | null;
  notes: string | null;
  resume_tex: string | null;
  resume_md: string | null;
  resume_json: string | null;
  cover_letter_md: string | null;
  submitted_at: string | null;
  discovered_at: string;
  updated_at: string;
};
