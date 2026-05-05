export type ExperimentStatus =
  | "proxy_failed"          // sniff test failed, no PR opened
  | "pr_open"               // PR submitted, awaiting merge
  | "merged_awaiting_swipes" // merged but <80% of tagged jobs have been swiped
  | "evaluated";            // swipe data written back, experiment complete

export interface ProxyResults {
  baseline_surfaced_per_day: number;
  experiment_surfaced: number;
  quality_signals: string;
  agent_verdict: "ship" | "no_ship";
  agent_reasoning: string;
}

export interface SwipeResults {
  jobs_tagged: number;
  jobs_swiped: number;
  approved: number;
  rejected: number;
  skipped: number;
  approval_rate: number;
  baseline_approval_rate: number;
  verdict: string;
}

export interface ExperimentLog {
  id: string;
  date: string;
  status: ExperimentStatus;
  problem: string;
  hypothesis: string;
  change: {
    type: "filter" | "threshold" | "keywords" | "scoring_rubric" | "source";
    description: string;
    files_changed: string[];
  };
  proxy_results: ProxyResults;
  pr_url?: string;
  pr_number?: number;
  merge_date?: string;
  swipe_results?: SwipeResults;
}
