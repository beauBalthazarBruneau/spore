import { execFile, execSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import type { ResumeJson } from "./schema";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// LaTeX escaping
// ---------------------------------------------------------------------------

export function escapeTex(s: string): string {
  return s
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/&/g, "\\&")
    .replace(/%/g, "\\%")
    .replace(/\$/g, "\\$")
    .replace(/#/g, "\\#")
    .replace(/_/g, "\\_")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

// ---------------------------------------------------------------------------
// JSON → LaTeX
// ---------------------------------------------------------------------------

export function jsonToTex(resume: ResumeJson): string {
  const { name, contact, summary, experience, education, skills } = resume;

  // Contact row
  const contactParts: string[] = [escapeTex(contact.email)];
  if (contact.phone) contactParts.push(escapeTex(contact.phone));
  if (contact.location) contactParts.push(escapeTex(contact.location));
  if (contact.links) {
    for (const [label, url] of Object.entries(contact.links)) {
      contactParts.push(`\\href{${escapeTex(url)}}{${escapeTex(label)}}`);
    }
  }

  // Summary section
  const summaryTex = summary
    ? `\\section*{Summary}\\hrule\\vspace{4pt}\n${escapeTex(summary)}\n`
    : "";

  // Experience section
  const expItems = experience.map((exp) => {
    const bullets = exp.bullets
      .map((b) => `  \\item ${escapeTex(b)}`)
      .join("\n");
    const locationLine = exp.location
      ? `\n\\textit{${escapeTex(exp.location)}}\n`
      : "";
    return `\\textbf{${escapeTex(exp.company)} --- ${escapeTex(exp.title)}} \\hfill ${escapeTex(exp.dates)}${locationLine}
\\begin{itemize}[noitemsep,topsep=2pt,leftmargin=*]
${bullets}
\\end{itemize}
\\vspace{4pt}`;
  });

  const experienceTex =
    experience.length > 0
      ? `\\section*{Experience}\\hrule\\vspace{4pt}\n${expItems.join("\n")}\n`
      : "";

  // Education section
  const eduItems = education.map(
    (edu) =>
      `\\textbf{${escapeTex(edu.institution)}} \\hfill ${escapeTex(edu.dates)}\n` +
      `${escapeTex(edu.degree)}\n`,
  );

  const educationTex =
    education.length > 0
      ? `\\section*{Education}\\hrule\\vspace{4pt}\n${eduItems.join("\\vspace{4pt}\n")}\n`
      : "";

  // Skills section
  let skillsTex = "";
  if (skills && Object.keys(skills).length > 0) {
    const rows = Object.entries(skills)
      .map(
        ([category, items]) =>
          `  \\textbf{${escapeTex(category)}:} & ${items.map(escapeTex).join(", ")} \\\\`,
      )
      .join("\n");
    skillsTex = `\\section*{Skills}\\hrule\\vspace{4pt}\n\\begin{tabular}{@{}p{1.2in}p{5in}@{}}\n${rows}\n\\end{tabular}\n`;
  }

  return `\\documentclass[11pt,letterpaper]{article}
\\usepackage[margin=0.75in]{geometry}
\\usepackage{enumitem}
\\usepackage{titlesec}
\\usepackage{hyperref}
\\usepackage[T1]{fontenc}
\\usepackage{lmodern}
\\pagestyle{empty}

\\titlespacing*{\\section}{0pt}{8pt}{4pt}

\\begin{document}

\\begin{center}
\\textbf{\\LARGE ${escapeTex(name)}}\\\\[4pt]
${contactParts.join(" \\quad|\\quad ")}
\\end{center}

\\vspace{4pt}

${summaryTex}
${experienceTex}
${educationTex}
${skillsTex}

\\end{document}
`;
}

// ---------------------------------------------------------------------------
// pdflatex subprocess
// ---------------------------------------------------------------------------

export async function renderPdf(source: string): Promise<Buffer> {
  const tmpDir = `/tmp/spore-render-${randomUUID()}`;
  mkdirSync(tmpDir, { recursive: true });
  const texPath = join(tmpDir, "resume.tex");
  const pdfPath = join(tmpDir, "resume.pdf");

  try {
    writeFileSync(texPath, source, "utf8");

    const runLatex = () =>
      execFileAsync("pdflatex", [
        "-interaction=nonstopmode",
        `-output-directory=${tmpDir}`,
        texPath,
      ]);

    // Run twice — standard LaTeX practice for cross-references
    let lastResult: { stdout: string; stderr: string } = { stdout: "", stderr: "" };
    for (let i = 0; i < 2; i++) {
      try {
        lastResult = await runLatex();
      } catch (e: unknown) {
        const err = e as { stdout?: string; stderr?: string; message?: string };
        const combined = ((err.stdout ?? "") + "\n" + (err.stderr ?? "")).trim();
        const lines = combined.split("\n");
        const tail = lines.slice(-20).join("\n");
        throw new Error(`pdflatex failed (pass ${i + 1}):\n${tail}`);
      }
    }

    return readFileSync(pdfPath);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function renderResumePdf(resume: ResumeJson): Promise<Buffer> {
  const tex = jsonToTex(resume);
  return renderPdf(tex);
}
