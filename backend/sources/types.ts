export interface RawPosting {
  source: string;
  source_job_id: string;
  url: string;
  title: string;
  company_name: string;
  company_domain?: string;
  location?: string;
  remote?: string;
  salary_min?: number;
  salary_max?: number;
  salary_range?: string;
  posted_at?: string;
  description?: string;
  raw: unknown;
}

export interface SourceAdapter {
  name: string;
  search(opts: SearchOpts): Promise<RawPosting[]>;
}

export interface SearchOpts {
  companies?: string[];
  titles?: string[];
  keywords?: string[];
  maxPerCompany?: number;
}
