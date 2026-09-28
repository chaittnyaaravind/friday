import { describe, expect, it } from "vitest";
import { extractSkills, skillBySlug } from "@/lib/domain/skills";
import { buildResume } from "./generate";
import { applyTerminology, isSpellingVariant, sameSkill, SPELLING_VARIANTS, undoTerms } from "./terminology";
import type { CandidateItem, DocLine, ResumeDoc, Section } from "./types";
import { validateDoc } from "./validate";

let n = 0;
const item = (section: Section, data: unknown): CandidateItem => ({
  id: `it-${++n}`, section, position: n, data: data as never, source: "user", source_text: null, source_resume_id: null, status: "user_confirmed", note: null, created_at: "", updated_at: "",
});
const skill = (name: string, group = "Skills") => item("skill", { name, group });

const ITEMS: CandidateItem[] = [
  item("personal", { field: "name", value: "Sam Student" }),
  skill("nodejs", "Backend"), skill("SQL", "Backend"), skill("k8s", "DevOps"), skill("Postgres", "Databases"),
  skill("GitHub", "Tools"), skill("Keras", "ML"), skill("EC2", "Cloud"), skill("Golang", "Languages"), skill("Python", "Languages"),
  item("experience", {
    title: "Backend Intern", organization: "Acme", location: "San Jose, CA", start: "Jun 2025", end: "Aug 2025",
    bullets: ["Built REST API services in nodejs and deployed them to k8s", "Migrated reporting tables to Postgres", "Automated builds with GitHub Actions", "Trained a Keras model on EC2", "Wrote tools in Golang"],
  }),
  item("project", { name: "Tracker", technologies: ["nodejs", "Postgres"], date: "2025", link: null, bullets: ["Built an API in nodejs"] }),
];
const build = () => buildResume(ITEMS);
const lines = (d: ResumeDoc): DocLine[] => d.sections.flatMap((s) => [...s.lines, ...s.entries.flatMap((e) => e.bullets)]);
const textOf = (d: ResumeDoc) => lines(d).map((l) => l.text).join("\n");

const JOB = "We build services with Node.js, Kubernetes and PostgreSQL. Experience with Git, TensorFlow and AWS is a plus. Our newest services are written in Go.";

describe("applyTerminology — renames a spelling to the job's, nothing more", () => {
  const { doc, changes } = applyTerminology(build(), JOB);

  it("rewrites whitelisted spellings in skills lines and bullets to the taxonomy's name the job uses", () => {
    const t = textOf(doc);
    expect(t).toContain("Backend: Node.js, SQL");
    expect(t).toContain("DevOps: Kubernetes");
    expect(t).toContain("Databases: PostgreSQL");
    expect(t).toContain("Built REST API services in Node.js and deployed them to Kubernetes");
    expect(t).toContain("Migrated reporting tables to PostgreSQL");
    expect(t).toContain("Built an API in Node.js");
  });
  it("records each change with the skill, both spellings, where it was and the line before and after", () => {
    const nodejs = changes.find((c) => c.from === "nodejs" && c.where === "Skills")!;
    expect(nodejs).toMatchObject({ skill: "Node.js", to: "Node.js", before: "Backend: nodejs, SQL", after: "Backend: Node.js, SQL" });
    expect(changes.find((c) => c.where === "Experience · Backend Intern" && c.from === "k8s")).toMatchObject({ skill: "Kubernetes", to: "Kubernetes" });
    for (const c of changes) {
      expect(c.before).not.toBe(c.after);
      expect(c.after).toContain(c.to);
    }
  });
  it("marks each rewritten line with its renames, so they can be undone", () => {
    for (const l of lines(doc).filter((x) => x.terms?.length)) {
      for (const t of l.terms!) expect(l.text).toContain(t.to);
    }
    expect(lines(doc).filter((l) => l.terms?.length).length).toBeGreaterThan(3);
  });
  it("never changes a sub-skill into the broader skill the job names (GitHub → Git, Keras → TensorFlow, EC2 → AWS, Golang → Go)", () => {
    const t = textOf(doc);
    expect(t).toContain("GitHub: ".slice(0, 6)); // GitHub is still there
    expect(t).toContain("Automated builds with GitHub Actions");
    expect(t).toContain("Tools: GitHub");
    expect(t).toContain("ML: Keras");
    expect(t).toContain("Trained a Keras model on EC2");
    expect(t).toContain("Cloud: EC2");
    expect(t).toContain("Wrote tools in Golang");
    expect(t).toContain("Languages: Golang, Python");
    expect(changes.map((c) => c.from.toLowerCase())).not.toEqual(expect.arrayContaining(["github", "keras", "ec2", "golang"]));
  });
  it("leaves headings, subheadings and dates alone", () => {
    const project = doc.sections.find((s) => s.kind === "projects")!.entries[0];
    expect(project.subheading).toBe("nodejs, Postgres"); // technologies in a heading are not rewritten
    expect(project.heading).toBe("Tracker");
  });
  it("the student's original wording is always recoverable: undoing every rename gives the original text", () => {
    const original = lines(build());
    const after = lines(doc);
    expect(after).toHaveLength(original.length);
    after.forEach((l, i) => expect(undoTerms(l.text, l.terms)).toBe(original[i].text));
  });
  it("does not mutate its input", () => {
    const d = build();
    const snapshot = JSON.stringify(d);
    applyTerminology(d, JOB);
    expect(JSON.stringify(d)).toBe(snapshot);
  });
  it("is idempotent: renaming twice changes nothing more", () => {
    const again = applyTerminology(doc, JOB);
    expect(again.changes).toEqual([]);
    expect(again.doc).toBe(doc);
  });
  it("adds no skill: the skills a document names are the same before and after", () => {
    const before = new Set(extractSkills(textOf(build())));
    const afterSkills = new Set(extractSkills(textOf(doc)));
    expect(afterSkills).toEqual(before);
  });
});

describe("applyTerminology — when it must do nothing", () => {
  it("a resume that does not name the skill is never given it (the job's Node.js is not added)", () => {
    const d = buildResume([item("personal", { field: "name", value: "Sam" }), skill("Python", "Languages"), item("experience", { title: "Intern", organization: "Acme", location: "", start: "Jun 2025", end: "Aug 2025", bullets: ["Wrote scripts in Python"] })]);
    const r = applyTerminology(d, JOB);
    expect(r.doc).toBe(d);
    expect(r.changes).toEqual([]);
    expect(textOf(r.doc)).not.toMatch(/Node\.js|Kubernetes|PostgreSQL/);
  });
  it("only when the JOB spells the skill with the taxonomy's own name: 'NodeJS' in the job is not a reason to rewrite", () => {
    const r = applyTerminology(build(), "We use NodeJS and k8s daily.");
    expect(textOf(r.doc)).toContain("Backend: nodejs");
    expect(r.changes.some((c) => c.skill === "Node.js")).toBe(false);
  });
  it("a line that already uses the job's spelling is left as it is", () => {
    const d = buildResume([item("personal", { field: "name", value: "Sam" }), skill("nodejs", "Backend"), skill("Node.js", "Backend"), item("experience", { title: "Intern", organization: "Acme", location: "", start: "Jun 2025", end: "Aug 2025", bullets: ["Used Node.js, nodejs style guides"] })]);
    const bullets = applyTerminology(d, JOB).doc.sections.find((s) => s.kind === "experience")!.entries[0].bullets;
    expect(bullets[0].text).toBe("Used Node.js, nodejs style guides");
  });
  it("case-only differences are not 'terminology': 'postgresql' stays 'postgresql'", () => {
    const d = buildResume([item("personal", { field: "name", value: "Sam" }), item("experience", { title: "Intern", organization: "Acme", location: "", start: "Jun 2025", end: "Aug 2025", bullets: ["Queried postgresql"] })]);
    expect(textOf(applyTerminology(d, JOB).doc)).toContain("Queried postgresql");
  });
  it("only lines FRIDAY built from the profile are touched — never the student's own words or an accepted AI edit", () => {
    const d = build();
    const exp = d.sections.find((s) => s.kind === "experience")!.entries[0];
    exp.bullets[0] = { ...exp.bullets[0], origin: "user" };
    exp.bullets[1] = { ...exp.bullets[1], origin: "ai" };
    const r = applyTerminology(d, JOB).doc.sections.find((s) => s.kind === "experience")!.entries[0].bullets;
    expect(r[0].text).toContain("nodejs");
    expect(r[1].text).toContain("Postgres");
    expect(r[0].terms).toBeUndefined();
  });
  it("a job that names none of the whitelisted skills changes nothing", () => {
    const d = build();
    expect(applyTerminology(d, "Looking for someone who loves Python and SQL.").doc).toBe(d);
  });
});

describe("the whitelist is honest", () => {
  it("every variant is a real taxonomy alias of the SAME skill, spelled differently from its name (not just in case)", () => {
    for (const [slug, variants] of Object.entries(SPELLING_VARIANTS)) {
      const k = skillBySlug(slug);
      expect(k, slug).toBeDefined();
      for (const v of variants) {
        expect(k!.aliases, `${slug}: ${v}`).toContain(v);
        expect(v.toLowerCase(), `${slug}: ${v}`).not.toBe(k!.name.toLowerCase());
        expect(sameSkill(v, k!.name), `${v} → ${k!.name}`).toBe(true);
      }
    }
  });
  it("it excludes the ambiguous spellings on purpose: Go, C, R, JS, TS, ML", () => {
    for (const slug of ["go", "c", "r", "javascript", "typescript", "ml"]) expect(SPELLING_VARIANTS[slug], slug).toBeUndefined();
  });
  it("isSpellingVariant accepts whitelisted renames and rejects sub-skills and unknowns", () => {
    expect(isSpellingVariant("nodejs", "Node.js")).toBe(true);
    expect(isSpellingVariant("K8S", "Kubernetes")).toBe(true);
    for (const [from, to] of [["Keras", "TensorFlow"], ["GitHub", "Git"], ["EC2", "AWS"], ["golang", "Go"], ["nodejs", "Kubernetes"], ["Python", "Node.js"]]) expect(isSpellingVariant(from, to), `${from} → ${to}`).toBe(false);
  });
});

describe("the truth check and terminology together", () => {
  it("a document with valid renames still passes validateDoc — the check undoes them and tests the student's own wording", () => {
    const { doc, changes } = applyTerminology(build(), JOB);
    expect(changes.length).toBeGreaterThan(0);
    expect(validateDoc(build(), ITEMS).ok).toBe(true);
    const v = validateDoc(doc, ITEMS);
    expect(v.issues).toEqual([]);
    expect(v.ok).toBe(true);
  });
  it("a rename record that is not a pure spelling variant is REJECTED, even though the taxonomy calls the two 'the same skill'", () => {
    const d = build();
    const b = d.sections.find((s) => s.kind === "experience")!.entries[0].bullets[3]; // "Trained a Keras model on EC2"
    const forged: DocLine = { ...b, text: b.text.replace("Keras", "TensorFlow"), terms: [{ from: "Keras", to: "TensorFlow" }] };
    d.sections.find((s) => s.kind === "experience")!.entries[0].bullets[3] = forged;
    const v = validateDoc(d, ITEMS);
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.claim === "Keras → TensorFlow")).toBe(true);
  });
  it("a rename whose original spelling the profile does not support is rejected: it cannot launder a skill the student lacks", () => {
    const d = build();
    const exp = d.sections.find((s) => s.kind === "experience")!.entries[0];
    // The student never wrote "mongo"; a forged record claims they did.
    exp.bullets[0] = { ...exp.bullets[0], text: "Built REST API services in MongoDB", terms: [{ from: "mongo", to: "MongoDB" }] };
    const v = validateDoc(d, ITEMS);
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => /mongo/i.test(i.claim))).toBe(true);
  });
  it("terms on a line the student wrote, or that an AI wrote, are ignored: the text is checked as it stands", () => {
    const d = build();
    const exp = d.sections.find((s) => s.kind === "experience")!.entries[0];
    exp.bullets[1] = { ...exp.bullets[1], text: "Migrated tables to PostgreSQL", origin: "profile", terms: [] };
    // With no recorded rename, "PostgreSQL" is not what the student wrote ("Postgres"): rejected, exactly as before this feature.
    expect(validateDoc(d, ITEMS).ok).toBe(false);
  });
  it("EXISTING BEHAVIOR: a document with no terms validates exactly as before", () => {
    expect(validateDoc(build(), ITEMS)).toEqual({ ok: true, issues: [] });
    const d = build();
    d.sections.find((s) => s.kind === "experience")!.entries[0].bullets[0].text = "Built REST API services in Rust";
    expect(validateDoc(d, ITEMS).ok).toBe(false);
  });
});
