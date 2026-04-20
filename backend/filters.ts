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

  // Location filter: reject roles that are neither remote nor in an accepted location.
  // Uses criteria.locations as the allowlist (e.g. ["New York, NY", "Remote"]).
  if (criteria.locations?.length) {
    const isRemote =
      /remote/i.test(p.remote ?? "") ||
      /remote/i.test(p.location ?? "");
    const allowsRemote = criteria.locations.some((l) => /remote/i.test(l));

    if (isRemote && allowsRemote) {
      // Remote role + user accepts remote → pass
    } else if (p.location) {
      // Extract city keywords from accepted locations for fuzzy matching.
      // "New York, NY" → "new york", "San Francisco, CA" → "san francisco"
      const acceptedCities = criteria.locations
        .filter((l) => !/remote/i.test(l))
        .map((l) => l.replace(/,?\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC|USA?)$/i, "").trim().toLowerCase());
      const locMatch = acceptedCities.some((city) => loc.includes(city));
      if (!locMatch && !isRemote) {
        return { passed: false, reason: `location '${p.location}' not in accepted locations` };
      }
    }
  }

  return { passed: true };
}
