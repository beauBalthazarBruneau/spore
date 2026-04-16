import type { RawPosting } from "./sources/types";

export interface Exclusions {
  companies?: string[];
  company_domains?: string[];
  title_keywords?: string[];
  description_keywords?: string[];
  industries?: string[];
  locations?: string[];
  seniority?: string[];
  visa_required?: boolean;
}

export interface Criteria {
  titles?: string[];
  locations?: string[];
  keywords?: string[];
  exclusions?: Exclusions;
  salary_min?: number;
  remote_pref?: "remote" | "hybrid" | "onsite" | string;
}

export interface FilterResult {
  passed: boolean;
  reason?: string;
}

const ci = (s: string | undefined) => (s ?? "").toLowerCase();
const includesAny = (hay: string, needles: string[] | undefined) =>
  !!needles?.some((n) => n && hay.includes(n.toLowerCase()));

export function applyHardFilters(p: RawPosting, criteria: Criteria): FilterResult {
  const ex = criteria.exclusions ?? {};
  const title = ci(p.title);
  const desc = ci(p.description);
  const company = ci(p.company_name);
  const domain = ci(p.company_domain);
  const loc = ci(p.location);

  if (includesAny(company, ex.companies)) return { passed: false, reason: `excluded company: ${p.company_name}` };
  if (domain && includesAny(domain, ex.company_domains)) return { passed: false, reason: `excluded domain: ${p.company_domain}` };
  if (includesAny(title, ex.title_keywords)) return { passed: false, reason: `title excluded keyword` };
  if (includesAny(desc, ex.description_keywords)) return { passed: false, reason: `description excluded keyword` };
  if (loc && includesAny(loc, ex.locations)) return { passed: false, reason: `excluded location: ${p.location}` };
  if (includesAny(title, ex.seniority)) return { passed: false, reason: `excluded seniority` };

  if (criteria.salary_min && p.salary_max && p.salary_max < criteria.salary_min) {
    return { passed: false, reason: `salary ${p.salary_max} below floor ${criteria.salary_min}` };
  }

  if (criteria.remote_pref === "remote") {
    const remoteSignal = /remote/i.test(p.location ?? "") || /remote/i.test(p.remote ?? "");
    if (!remoteSignal && p.location && !/remote/i.test(p.location)) {
      // soft — only reject if an on-site-only phrase appears in description
      if (/\bon[-\s]?site only\b/i.test(p.description ?? "")) {
        return { passed: false, reason: "on-site only, user wants remote" };
      }
    }
  }

  return { passed: true };
}
