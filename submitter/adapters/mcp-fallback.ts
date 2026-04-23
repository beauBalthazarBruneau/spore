import type { SubmitInput, SubmitResult } from "../types";

export async function applyMcpFallback(_input: SubmitInput): Promise<SubmitResult> {
  throw new Error("not implemented");
}
