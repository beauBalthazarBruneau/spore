import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ExperimentLog } from "./types";

export function loadExperiments(dir: string): ExperimentLog[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(resolve(dir, f), "utf8")) as ExperimentLog)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function saveExperiment(dir: string, log: ExperimentLog): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, `${log.id}.json`), JSON.stringify(log, null, 2) + "\n", "utf8");
}

export function nextExperimentId(existing: ExperimentLog[]): string {
  if (existing.length === 0) return "exp-001";
  const last = existing[existing.length - 1].id;
  const n = parseInt(last.replace("exp-", ""), 10);
  return `exp-${String(n + 1).padStart(3, "0")}`;
}
