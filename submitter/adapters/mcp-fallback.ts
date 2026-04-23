import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SubmitInput, SubmitResult } from "../types";

const MCP_CONFIG = {
  mcpServers: {
    playwright: {
      command: "npx",
      args: ["@playwright/mcp@latest", "--headless"],
    },
  },
};

function buildPrompt(input: SubmitInput): string {
  const profile = input.profile;
  const lines: string[] = [
    `Fill out and submit the job application at: ${input.url}`,
    "",
    "Applicant profile:",
    `  Full name: ${profile.fullName}`,
    `  Email: ${profile.email}`,
    `  Phone: ${profile.phone ?? "N/A"}`,
    `  Location: ${profile.location ?? "N/A"}`,
  ];
  if (profile.linkedinUrl) lines.push(`  LinkedIn: ${profile.linkedinUrl}`);
  if (profile.githubUrl) lines.push(`  GitHub: ${profile.githubUrl}`);
  if (profile.portfolioUrl) lines.push(`  Portfolio: ${profile.portfolioUrl}`);

  if (input.questions.length > 0) {
    lines.push("", "Application Q&A:");
    for (const q of input.questions) {
      lines.push(`  Q: ${q.question}`);
      lines.push(`  A: ${q.answer ?? "(no answer — use best judgment)"}`);
    }
  }

  lines.push(
    "",
    "Instructions:",
    "1. Navigate to the application URL using Playwright.",
    "2. Fill every required field with the profile data above.",
    "3. If a resume upload is required, skip it — the applicant will handle that manually.",
    "4. Submit the form.",
    "5. After submission, output the final page URL as: CONFIRMATION_REF: <url>",
    "   If submission fails, output: SUBMISSION_ERROR: <reason>",
  );

  return lines.join("\n");
}

export async function applyMcpFallback(input: SubmitInput): Promise<SubmitResult> {
  const configDir = join(tmpdir(), `spore-mcp-fallback-${input.jobId}`);
  mkdirSync(configDir, { recursive: true });
  const configPath = join(configDir, "mcp-config.json");
  writeFileSync(configPath, JSON.stringify(MCP_CONFIG, null, 2));

  const prompt = buildPrompt(input);

  return new Promise((resolve) => {
    const args = [
      "--print",
      "--dangerously-skip-permissions",
      "--output-format", "stream-json",
      "--mcp-config", configPath,
      "--model", "claude-sonnet-4-6",
      prompt,
    ];

    const proc = spawn("claude", args);

    let textBuffer = "";
    let stdoutBuf = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
            textBuffer += event.delta.text;
          } else if (event.type === "assistant" && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "text") textBuffer += block.text;
            }
          }
        } catch {
          // skip malformed lines
        }
      }
    });

    proc.on("close", (code) => {
      try {
        rmSync(configDir, { recursive: true, force: true });
      } catch {
        // best effort cleanup
      }

      const confirmMatch = textBuffer.match(/CONFIRMATION_REF:\s*(\S+)/);
      if (confirmMatch) {
        return resolve({ success: true, confirmationRef: confirmMatch[1] });
      }

      const errorMatch = textBuffer.match(/SUBMISSION_ERROR:\s*(.+)/);
      if (errorMatch) {
        return resolve({ success: false, error: errorMatch[1].trim() });
      }

      if (code !== 0) {
        return resolve({ success: false, error: `Claude subprocess exited with code ${code}` });
      }

      // No structured output — treat as failure with raw tail for debugging
      const tail = textBuffer.slice(-500).trim();
      resolve({ success: false, error: `No confirmation from agent. Last output: ${tail || "(empty)"}` });
    });

    proc.on("error", (err) => {
      resolve({ success: false, error: `Failed to spawn claude CLI: ${err.message}` });
    });
  });
}
