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

// Map known link label prefixes to FontAwesome5 icons
function linkIcon(label: string): string {
  const l = label.toLowerCase();
  if (l.includes("linkedin")) return "\\faLinkedin";
  if (l.includes("github")) return "\\faGithub";
  if (l.includes("website") || l.includes("web") || l.includes("portfolio")) return "\\faGlobe";
  return "\\faLink";
}

export function jsonToTex(resume: ResumeJson): string {
  const { name, contact, summary, experience, education, skills } = resume;

  // Contact icon row — mirrors master_resume.tex header style
  const contactParts: string[] = [];
  if (contact.phone)
    contactParts.push(`\\raisebox{-0.1\\height}\\faPhone\\ ${escapeTex(contact.phone)}`);
  if (contact.location)
    contactParts.push(`\\raisebox{-0.1\\height}\\faMapMarker\\ ${escapeTex(contact.location)}`);
  contactParts.push(
    `\\href{mailto:${escapeTex(contact.email)}}{\\raisebox{-0.2\\height}\\faEnvelope\\ \\underline{${escapeTex(contact.email)}}}`
  );
  if (contact.links) {
    for (const [label, url] of Object.entries(contact.links)) {
      const icon = linkIcon(label);
      contactParts.push(
        `\\href{${escapeTex(url)}}{\\raisebox{-0.2\\height}${icon}\\ \\underline{${escapeTex(label)}}}`
      );
    }
  }

  // Summary section
  const summaryTex = summary
    ? `\\section{Summary}\n\\small{${escapeTex(summary)}}\n\\vspace{-8pt}\n`
    : "";

  // Experience section — bullets wrapped in \small{\mbox{}} to match master_resume.tex
  const expItems = experience.map((exp) => {
    const bullets = exp.bullets
      .map((b) => `  \\item\\small{\\mbox{${escapeTex(b)}}}\\vspace{-2pt}`)
      .join("\n");
    const locationLine = exp.location
      ? ` & \\textit{\\small ${escapeTex(exp.location)}} \\\\`
      : " \\\\";
    return `  \\vspace{-2pt}\\item
    \\begin{tabular*}{1.0\\textwidth}[t]{l@{\\extracolsep{\\fill}}r}
      \\textbf{${escapeTex(exp.company)}} & \\textbf{\\small ${escapeTex(exp.dates)}} \\\\
      \\textit{\\small ${escapeTex(exp.title)}}${locationLine}
    \\end{tabular*}\\vspace{-7pt}
    \\begin{itemize}
${bullets}
    \\end{itemize}\\vspace{-10pt}`;
  });

  const experienceTex =
    experience.length > 0
      ? `\\section{Experience}\n  \\begin{itemize}[leftmargin=0.0in, label={}]\n${expItems.join("\n")}\n  \\end{itemize}\n`
      : "";

  // Education section
  const eduItems = education.map(
    (edu) =>
      `  \\vspace{-2pt}\\item
    \\begin{tabular*}{1.0\\textwidth}[t]{l@{\\extracolsep{\\fill}}r}
      \\textbf{${escapeTex(edu.institution)}} \\\\
    \\end{tabular*}\\vspace{-7pt}
    \\begin{itemize}[leftmargin=0.15in]
      \\item\\small{\\textit{${escapeTex(edu.degree)}} \\hfill ${escapeTex(edu.dates)}}\\vspace{-2pt}
    \\end{itemize}\\vspace{-10pt}`,
  );

  const educationTex =
    education.length > 0
      ? `\\section{Education}\n  \\begin{itemize}[leftmargin=0.0in, label={}]\n${eduItems.join("\n")}\n  \\end{itemize}\n`
      : "";

  // Skills section
  let skillsTex = "";
  if (skills && Object.keys(skills).length > 0) {
    const rows = Object.entries(skills)
      .map(
        ([category, items]) =>
          `     \\textbf{${escapeTex(category)}}{: ${items.map(escapeTex).join(", ")}} \\\\`,
      )
      .join("\n");
    skillsTex = `\\section{Skills}\n \\begin{itemize}[leftmargin=0.0in, label={}]\n    \\small{\\item{\n${rows}\n    }}\n \\end{itemize}\n`;
  }

  return `\\documentclass[letterpaper,11pt]{article}

\\usepackage[top=0.375in,left=0.375in,right=0.375in,bottom=5pt]{geometry}
\\usepackage{titlesec}
\\usepackage[usenames,dvipsnames]{color}
\\usepackage{enumitem}
\\usepackage[hidelinks]{hyperref}
\\usepackage{fancyhdr}
\\usepackage{tabularx}
\\usepackage{fontawesome5}
\\usepackage{multicol}
\\setlength{\\multicolsep}{0pt}
\\input{glyphtounicode}

\\pagestyle{fancy}
\\fancyhf{}
\\fancyfoot{}
\\renewcommand{\\headrulewidth}{0pt}
\\renewcommand{\\footrulewidth}{0pt}

\\urlstyle{same}
\\raggedbottom
\\raggedright
\\setlength{\\tabcolsep}{0in}

\\titleformat{\\section}{%
  \\vspace{-4pt}\\scshape\\raggedright\\large\\bfseries%
}{}{0em}{}[\\color{black}\\titlerule \\vspace{-5pt}]

\\pdfgentounicode=1

\\renewcommand\\labelitemi{$\\vcenter{\\hbox{\\tiny$\\bullet$}}$}
\\renewcommand\\labelitemii{$\\vcenter{\\hbox{\\tiny$\\bullet$}}$}

\\begin{document}

\\begin{center}
  {\\Huge \\scshape ${escapeTex(name)}} \\\\ \\vspace{1pt}
  \\small
  ${contactParts.join(" ~\n  ")}
  \\vspace{-8pt}
\\end{center}

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
