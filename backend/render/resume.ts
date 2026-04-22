import { chromium } from "playwright";
import type { ResumeJson } from "./schema";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function jsonToHtml(resume: ResumeJson): string {
  const { name, contact, summary, experience, education, skills } = resume;

  // Build contact row
  const contactParts: string[] = [esc(contact.email)];
  if (contact.phone) contactParts.push(esc(contact.phone));
  if (contact.location) contactParts.push(esc(contact.location));
  if (contact.links) {
    for (const [label, url] of Object.entries(contact.links)) {
      contactParts.push(`<a href="${esc(url)}" style="color:#000;text-decoration:none;">${esc(label)}: ${esc(url)}</a>`);
    }
  }

  // Summary section
  const summaryHtml = summary
    ? `<section style="margin-bottom:12pt;">
        <div style="font-size:10.5pt;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #000;padding-bottom:2pt;margin-bottom:6pt;">Summary</div>
        <p style="margin:0;font-size:10.5pt;line-height:1.4;">${esc(summary)}</p>
       </section>`
    : "";

  // Experience section
  const expItems = experience.map((exp) => {
    const bullets = exp.bullets
      .map((b) => `<li style="margin-bottom:2pt;">${esc(b)}</li>`)
      .join("\n");
    return `
      <div style="margin-bottom:10pt;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;">
          <span style="font-size:10.5pt;font-weight:700;">${esc(exp.company)} — ${esc(exp.title)}</span>
          <span style="font-size:10pt;color:#333;">${esc(exp.dates)}</span>
        </div>
        ${exp.location ? `<div style="font-size:10pt;color:#555;margin-top:1pt;">${esc(exp.location)}</div>` : ""}
        <ul style="margin:4pt 0 0 0;padding-left:18pt;font-size:10.5pt;line-height:1.4;">
          ${bullets}
        </ul>
      </div>`;
  }).join("\n");

  const experienceHtml = experience.length > 0
    ? `<section style="margin-bottom:12pt;">
        <div style="font-size:10.5pt;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #000;padding-bottom:2pt;margin-bottom:6pt;">Experience</div>
        ${expItems}
       </section>`
    : "";

  // Education section
  const eduItems = education.map((edu) => `
    <div style="margin-bottom:6pt;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;">
        <span style="font-size:10.5pt;font-weight:700;">${esc(edu.institution)}</span>
        <span style="font-size:10pt;color:#333;">${esc(edu.dates)}</span>
      </div>
      <div style="font-size:10.5pt;color:#333;">${esc(edu.degree)}</div>
    </div>`).join("\n");

  const educationHtml = education.length > 0
    ? `<section style="margin-bottom:12pt;">
        <div style="font-size:10.5pt;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #000;padding-bottom:2pt;margin-bottom:6pt;">Education</div>
        ${eduItems}
       </section>`
    : "";

  // Skills section
  let skillsHtml = "";
  if (skills && Object.keys(skills).length > 0) {
    const skillRows = Object.entries(skills).map(([category, items]) =>
      `<div style="margin-bottom:4pt;font-size:10.5pt;">
        <span style="font-weight:700;">${esc(category)}:</span> ${items.map(esc).join(", ")}
       </div>`,
    ).join("\n");
    skillsHtml = `<section style="margin-bottom:12pt;">
      <div style="font-size:10.5pt;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #000;padding-bottom:2pt;margin-bottom:6pt;">Skills</div>
      ${skillRows}
    </section>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(name)} — Resume</title>
  <style>
    @page { size: letter; margin: 0.75in; }
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, Arial, sans-serif;
      font-size: 10.5pt;
      color: #000;
      background: #fff;
      margin: 0;
      padding: 0;
    }
    a { color: #000; }
  </style>
</head>
<body>
  <header style="text-align:center;margin-bottom:10pt;">
    <h1 style="margin:0;font-size:18pt;font-weight:700;letter-spacing:0.02em;">${esc(name)}</h1>
    <div style="font-size:10pt;color:#333;margin-top:4pt;">
      ${contactParts.join(" &nbsp;|&nbsp; ")}
    </div>
  </header>
  <hr style="border:none;border-top:1px solid #000;margin:0 0 12pt 0;" />
  ${summaryHtml}
  ${experienceHtml}
  ${educationHtml}
  ${skillsHtml}
</body>
</html>`;
}

export async function renderPdf(html: string): Promise<Buffer> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdfBytes = await page.pdf({ format: "Letter", printBackground: true });
    return Buffer.from(pdfBytes);
  } finally {
    await browser.close();
  }
}

export async function renderResumePdf(resume: ResumeJson): Promise<Buffer> {
  const html = jsonToHtml(resume);
  return renderPdf(html);
}
