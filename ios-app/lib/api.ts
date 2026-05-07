import { getBaseUrl } from './storage';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${path}: ${text || res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

const json = (body: unknown) => ({ body: JSON.stringify(body) });

export type JobStatus =
  | 'fetched'
  | 'new' | 'approved' | 'rejected' | 'skipped'
  | 'needs_tailoring' | 'tailoring' | 'tailored' | 'ready_to_apply'
  | 'applied' | 'interview_invite' | 'declined' | 'on_hold'
  | 'submitting' | 'submission_failed';

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
  agent_rejection_reason: string | null;
  user_rejection_reason: string | null;
  approval_reason: string | null;
  approval_note: string | null;
  notes: string | null;
  discovered_at: string;
  updated_at: string;
};

export type Profile = {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  links_json: Record<string, string>;
  preferences_json: Record<string, unknown>;
  criteria_json: {
    titles?: string[];
    locations?: string[];
    keywords?: string[];
    salary_min?: number;
    remote_pref?: string;
  };
};

export type AgentMessage = {
  id: number;
  role: 'user' | 'assistant' | 'divider';
  text: string;
  created_at: string;
};

export const REJECTION_REASONS = [
  'not_interested',
  'bad_fit',
  'bad_company',
  'overqualified',
  'underqualified',
  'location',
  'salary',
  'other',
] as const;

export const BOARD_STATUSES: JobStatus[] = [
  'new', 'approved', 'needs_tailoring', 'tailoring', 'tailored',
  'ready_to_apply', 'applied', 'interview_invite',
  'declined', 'on_hold',
];

export const api = {
  getJobs: (statuses?: JobStatus[]) => {
    const qs = statuses?.map(s => `status=${s}`).join('&') ?? '';
    return request<Job[]>(`/api/jobs${qs ? `?${qs}` : ''}`);
  },

  getJob: (id: number) => request<Job>(`/api/jobs/${id}`),

  patchJob: (id: number, patch: Partial<Pick<Job, 'status' | 'rejection_reason' | 'rejection_note' | 'approval_note' | 'notes'>>) =>
    request<Job>(`/api/jobs/${id}`, { method: 'PATCH', ...json(patch) }),

  getProfile: () => request<Profile>('/api/profile'),

  patchProfile: (patch: Partial<Profile>) =>
    request<Profile>('/api/profile', { method: 'PATCH', ...json(patch) }),

  getAgentMessages: () => request<AgentMessage[]>('/api/agent'),

  clearAgentSession: () => request<void>('/api/agent', { method: 'DELETE' }),
};
