export interface ApplicantProfile {
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  location: string;
  city: string;
  state: string;
  country: string;
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
  resumePdfPath: string;
  coverLetterPdfPath: string | null;
}

export interface ApplicationQuestion {
  id: number;
  question: string;
  answer: string | null;
  fieldType: string | null;
  fieldSelector: string | null;
}

export interface SubmitInput {
  jobId: number;
  url: string;
  atsSource: string | null;
  profile: ApplicantProfile;
  questions: ApplicationQuestion[];
}

export interface SubmitResult {
  success: boolean;
  confirmationRef?: string;
  error?: string;
}
