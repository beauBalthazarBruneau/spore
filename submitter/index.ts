import type { SubmitInput, SubmitResult } from "./types";
import { applyGreenhouse } from "./adapters/greenhouse";
import { applyLever } from "./adapters/lever";
import { applyAshby } from "./adapters/ashby";
import { applyMcpFallback } from "./adapters/mcp-fallback";

export async function submitJob(input: SubmitInput): Promise<SubmitResult> {
  switch (input.atsSource) {
    case "greenhouse": return applyGreenhouse(input);
    case "lever":      return applyLever(input);
    case "ashby":      return applyAshby(input);
    default:           return applyMcpFallback(input);
  }
}

export type { SubmitInput, SubmitResult, ApplicantProfile, ApplicationQuestion } from "./types";
