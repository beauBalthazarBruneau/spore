import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

export const dynamic = "force-dynamic";

const REPO_ROOT = resolve(process.cwd(), "..");

function runSubmitCli(jobId: number): Promise<{ success: boolean; confirmationRef?: string; error?: string }> {
  return new Promise((res) => {
    const proc = spawn(
      "npx",
      ["tsx", "submitter/submit-cli.ts", String(jobId)],
      { cwd: REPO_ROOT },
    );

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on("close", (code) => {
      const lastLine = stdout.trim().split("\n").pop() ?? "";
      try {
        res(JSON.parse(lastLine));
      } catch {
        res({ success: false, error: `Submit CLI failed (code ${code}): ${stderr.slice(0, 300) || lastLine}` });
      }
    });

    proc.on("error", (err) => {
      res({ success: false, error: `Failed to spawn submit CLI: ${err.message}` });
    });
  });
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const jobId = Number(params.id);
  if (!jobId) return NextResponse.json({ success: false, error: "invalid job id" }, { status: 400 });

  const result = await runSubmitCli(jobId);
  const status = result.success ? 200 : 422;
  return NextResponse.json(result, { status });
}
