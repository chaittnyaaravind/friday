// Generates test/fixtures/sample-resume.{pdf,docx} — a realistic one-page student resume
// used by the parser tests and the end-to-end check. Fictional person; test data only.
// Run: node test/fixtures/make-resume.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { AlignmentType, Document, Packer, Paragraph, TabStopType, TextRun } from "docx";

const here = dirname(fileURLToPath(import.meta.url));

export const RESUME = {
  name: "Jordan Lee",
  contact: ["San Jose, CA", "jordan.lee@example.com", "(408) 555-0142", "linkedin.com/in/jordanlee-dev", "github.com/jordanlee-dev"],
  sections: [
    { heading: "EDUCATION", entries: [
      { left: "San José State University", right: "Aug 2023 – May 2027", sub: "B.S. Computer Science · GPA: 3.62", bullets: ["Relevant Coursework: Data Structures, Algorithms, Operating Systems, Database Systems"] },
    ] },
    { heading: "EXPERIENCE", entries: [
      { left: "SJSU Computer Science Department", right: "Sep 2025 – Present", sub: "Student Lab Assistant", bullets: [
        "Helped students debug Java and Python assignments during weekly lab hours",
        "Maintained lab setup scripts in Bash on Linux machines",
      ] },
      { left: "Bright Harbor Labs", right: "Jun 2025 – Aug 2025", sub: "Software Engineering Intern", bullets: [
        "Built REST API endpoints in Node.js and Express backed by PostgreSQL",
        "Wrote React components for an internal dashboard and added Jest unit tests",
      ] },
    ] },
    { heading: "PROJECTS", entries: [
      { left: "CampusEats | React, Node.js, PostgreSQL, Docker", right: "Spring 2025", bullets: ["Full-stack app for ordering from campus cafes, deployed with Docker"] },
      { left: "Pathfinder Visualizer | TypeScript", right: "Fall 2024", bullets: ["Visualizes BFS, DFS and A* search on an interactive grid"] },
    ] },
    { heading: "TECHNICAL SKILLS", lines: [
      "Languages: Java, Python, JavaScript, TypeScript, SQL",
      "Frameworks & Tools: React, Node.js, Express, Git, Docker, Linux",
    ] },
    { heading: "CERTIFICATIONS", lines: ["AWS Certified Cloud Practitioner (2025)"] },
    { heading: "AWARDS", lines: ["Dean's Scholar, San José State University (2024)"] },
    { heading: "HOBBIES", lines: ["Rock climbing, film photography"] },
  ],
};

async function pdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ital = await doc.embedFont(StandardFonts.HelveticaOblique);
  const L = 54, R = 558;
  let y = 740;
  const text = (s, x, size, font = reg) => page.drawText(s, { x, y, size, font, color: rgb(0.1, 0.1, 0.1) });
  const right = (s, size, font = reg) => text(s, R - font.widthOfTextAtSize(s, size), size, font);

  const nameW = bold.widthOfTextAtSize(RESUME.name, 20);
  text(RESUME.name, (612 - nameW) / 2, 20, bold);
  y -= 18;
  const c = RESUME.contact.join("  |  ");
  text(c, (612 - reg.widthOfTextAtSize(c, 9)) / 2, 9);
  y -= 22;
  for (const s of RESUME.sections) {
    text(s.heading, L, 11, bold);
    page.drawLine({ start: { x: L, y: y - 3 }, end: { x: R, y: y - 3 }, thickness: 0.6, color: rgb(0.3, 0.3, 0.3) });
    y -= 16;
    for (const e of s.entries ?? []) {
      text(e.left, L, 10, bold);
      right(e.right, 10);
      y -= 13;
      if (e.sub) { text(e.sub, L, 10, ital); y -= 13; }
      for (const b of e.bullets) { text("•", L + 6, 10); text(b, L + 16, 10); y -= 13; }
      y -= 4;
    }
    for (const line of s.lines ?? []) { text(line, L, 10); y -= 13; }
    y -= 6;
  }
  writeFileSync(join(here, "sample-resume.pdf"), await doc.save());
}

async function docx() {
  const P = (children, opts = {}) => new Paragraph({ children, ...opts });
  const tab = [{ type: TabStopType.RIGHT, position: 10000 }];
  const children = [
    P([new TextRun({ text: RESUME.name, bold: true, size: 36 })], { alignment: AlignmentType.CENTER }),
    P([new TextRun({ text: RESUME.contact.join(" | "), size: 18 })], { alignment: AlignmentType.CENTER }),
  ];
  for (const s of RESUME.sections) {
    children.push(P([new TextRun({ text: s.heading, bold: true })]));
    for (const e of s.entries ?? []) {
      children.push(P([new TextRun({ text: e.left, bold: true }), new TextRun({ text: `\t${e.right}` })], { tabStops: tab }));
      if (e.sub) children.push(P([new TextRun({ text: e.sub, italics: true })]));
      for (const b of e.bullets) children.push(P([new TextRun(b)], { bullet: { level: 0 } }));
    }
    for (const line of s.lines ?? []) children.push(P([new TextRun(line)]));
  }
  const buf = await Packer.toBuffer(new Document({ sections: [{ children }] }));
  writeFileSync(join(here, "sample-resume.docx"), buf);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await pdf();
  await docx();
  console.log("wrote sample-resume.pdf and sample-resume.docx");
}
