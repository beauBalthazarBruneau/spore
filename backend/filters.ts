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

// Broad country/region strings that indicate a role is remote-eligible rather
// than tied to a specific city. ATS boards often emit these for fully-remote or
// work-from-anywhere postings.
const BROAD_US_PATTERNS = /^(united states(?: of america)?|u\.?s\.?a?\.?|north america)$/i;

// Aliases for accepted city names. When a user lists "New York, NY" in their accepted
// locations, ATS boards often emit shorter or alternate forms ("NYC", "US-NYC",
// "DC, SF, NYC", "NYC-Privy"). Each canonical city (after state-suffix stripping and
// lowercasing) maps to a list of short aliases that should also match. Aliases are
// matched with word boundaries to avoid spurious substring hits (e.g. "ny" inside
// "company"); the canonical name still uses substring matching as before.
const CITY_ALIASES: Record<string, string[]> = {
  "new york": ["nyc"],
};

function cityMatches(loc: string, city: string): boolean {
  if (loc.includes(city)) return true;
  const aliases = CITY_ALIASES[city];
  if (!aliases) return false;
  return aliases.some((alias) => {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(loc);
  });
}

// Tokens that appear in hybrid location strings but are not city names.
// Used to detect "Hybrid" with no city context ("Hybrid; In-Office", "Distributed; Hybrid").
const HYBRID_NON_CITY_TOKENS = new Set([
  "hybrid", "distributed", "remote", "in", "office", "onsite", "on", "site",
  "and", "or", "the", "us", "work", "home", "based",
]);

// Returns true when a location containing "hybrid" has no identifiable city name —
// only work-arrangement descriptors like "In-Office" or "Distributed".
function isStandaloneHybrid(location: string): boolean {
  const tokens = location
    .toLowerCase()
    .replace(/[^a-z]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return tokens.every((t) => HYBRID_NON_CITY_TOKENS.has(t));
}

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

  // Location filter: reject roles that are neither remote/hybrid nor in an accepted location.
  // Uses criteria.locations as the allowlist (e.g. ["New York, NY", "Remote"]).
  if (criteria.locations?.length) {
    const acceptsRemote = criteria.locations.some((l) => /remote/i.test(l));
    const acceptsHybrid = criteria.remote_pref === "hybrid" || criteria.remote_pref === "remote";

    const isRemote =
      /remote/i.test(p.remote ?? "") ||
      /remote/i.test(p.location ?? "");

    // Standalone hybrid ("Hybrid", "Hybrid; In-Office", "Distributed; Hybrid") with
    // no identifiable city passes when remote_pref allows hybrid. Hybrid+city strings
    // ("Hybrid - San Francisco") fall through to city matching so only accepted
    // cities pass — reject "Hybrid - SF", pass "Hybrid - New York".
    const isStandalone =
      acceptsHybrid &&
      /hybrid/i.test(p.location ?? "") &&
      isStandaloneHybrid(p.location ?? "");

    // Broad country/region strings (e.g. "United States", "North America") mean
    // the ATS didn't specify a city — treat as remote-eligible when the user
    // accepts remote or hybrid.
    const isBroadUSRemote =
      acceptsHybrid &&
      p.location != null &&
      BROAD_US_PATTERNS.test(p.location.trim());

    if ((isRemote && acceptsRemote) || isStandalone || isBroadUSRemote) {
      // Role work-type matches user preference → pass
    } else if (p.location) {
      // Extract city keywords from accepted locations for fuzzy matching.
      // "New York, NY" → "new york", "San Francisco, CA" → "san francisco"
      const acceptedCities = criteria.locations
        .filter((l) => !/remote/i.test(l))
        .map((l) => l.replace(/,?\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC|USA?)$/i, "").trim().toLowerCase());
      const locMatch = acceptedCities.some((city) => cityMatches(loc, city));
      if (!locMatch && !isRemote) {
        return { passed: false, reason: `location '${p.location}' not in accepted locations` };
      }
    }
  }

  return { passed: true };
}
