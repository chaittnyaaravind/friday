/**
 * Tailoring, end to end against an in-memory database. The point of these tests is what tailoring must NOT do:
 * touch the uploaded original, the student's profile facts, their master resume or any earlier version — and invent skills.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractSkills } from "@/lib/domain/skills";
import { fakeDb, type FakeDb } from "@/lib/discovery/testing/fake-db";
import { buildResume } from "./generate";
import type { TailoringReport } from "./report";
import type { CandidateItem, ResumeDoc, Section } from "./types";

vi.mock("server-only", () => ({}));
vi.mock("./validate", async (orig) => {
  const m = await orig<typeof import("./validate")>();
  return { ...m, validateDoc: vi.fn(m.validateDoc) };
});
const { tailorResume } = await import("./tailor-service");
const { validateDoc } = await import("./validate");

const USER = "user-1";
let n = 0;
const item = (section: Section, data: unknown): CandidateItem & { user_id: string } => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, user_id: USER, section, position: n, data: data as never, source: "user", source_text: null, source_resume_id: null, status: "user_confirmed", note: null, created_at: "", updated_at: "",
});
const exp = (title: string, org: string, bullets: string[]) => item("experience", { title, organization: org, location: "San Jose, CA", start: "Jun 2025", end: "Aug 2025", bullets });
const ITEMS = [
  item("personal", { field: "name", value: "Sam Student" }),
  item("education", { school: "San José State University", degree: "B.S. Computer Science", start: "Aug 2023", end: "May 2027", gpa: null, details: [] }),
  exp("Backend Intern", "Acme", ["Built REST API services in nodejs and deployed them to k8s", "Migrated reporting tables to Postgres"]),
  exp("Library Assistant", "SJSU Library", ["Helped students find sources", "Maintained the help desk queue"]),
  item("project", { name: "Tracker", technologies: ["Python", "SQL"], date: "2025", link: null, bullets: ["Built a job tracker in Python"] }),
  item("skill", { name: "Python", group: "Languages" }), item("skill", { name: "SQL", group: "Languages" }),
  item("skill", { name: "nodejs", group: "Backend" }), item("skill", { name: "k8s", group: "DevOps" }), item("skill", { name: "Postgres", group: "Databases" }),
];
const JOB_ID = "11111111-1111-4111-8111-111111111111";
const job = (over: Record<string, unknown> = {}) => ({
  id: JOB_ID, title: "Software Engineering Intern", description: "Minimum qualifications\n• Node.js\n• Kubernetes\n• Docker\n• Rust\nYou will build services with Node.js on Kubernetes.",
  companies: { name: "Example Co" }, job_requirements: [{ label: "Node.js" }, { label: "Kubernetes" }, { label: "Docker" }, { label: "Rust" }], ...over,
});
const masterDoc = () => buildResume(ITEMS);

let db: FakeDb;
const seed = (extra: Record<string, unknown[]> = {}) =>
  fakeDb({
    candidate_items: structuredClone(ITEMS) as never,
    jobs: [job()] as never,
    resumes: [{ id: "resume-1", user_id: USER, file_name: "sam-resume.pdf", raw_text: "SAM STUDENT\nSkills: nodejs, k8s, Postgres", file_path: "resumes/user-1/a.pdf" }],
    resume_versions: [], tailoring_reports: [], notifications: [], ...extra,
  } as never);
const snapshot = (d: FakeDb, tables: string[]) => Object.fromEntries(tables.map((t) => [t, JSON.stringify(d.tables[t])]));
const writes = (d: FakeDb) => d.log.filter((l) => l.op !== "select");
const created = (r: Awaited<ReturnType<typeof tailorResume>>) => {
  if (!("version" in r)) throw new Error("expected a created version");
  return r;
};

beforeEach(() => {
  vi.mocked(validateDoc).mockClear();
  db = seed({
    resume_versions: [
      { id: "master-1", user_id: USER, kind: "base", label: "Resume v1", is_master: true, content: masterDoc(), job_id: null, source_version_id: null },
      { id: "old-tailored", user_id: USER, kind: "tailored", label: "Resume — Old Co", is_master: false, content: masterDoc(), job_id: "old-job", source_version_id: "master-1" },
    ],
  });
});

describe("preview (no accept)", () => {
  it("returns the proposal and the ATS spelling changes that WOULD be made, and writes nothing", async () => {
    const r = await tailorResume(db as never, USER, { jobId: JOB_ID });
    expect("proposal" in r).toBe(true);
    if (!("proposal" in r)) return;
    expect(r.proposal.job).toMatchObject({ id: JOB_ID, title: "Software Engineering Intern" });
    expect(r.terminology.map((t) => `${t.from}→${t.to}`)).toEqual(expect.arrayContaining(["nodejs→Node.js", "k8s→Kubernetes"]));
    expect(writes(db)).toEqual([]);
  });
});

describe("accepting creates a NEW version and its report — and touches nothing else", () => {
  it("inserts exactly one version and one report; every existing row is byte-for-byte unchanged", async () => {
    const before = snapshot(db, ["candidate_items", "resumes", "resume_versions", "jobs"]);
    const r = created(await tailorResume(db as never, USER, { jobId: JOB_ID, accept: true }));
    expect(writes(db)).toEqual([{ table: "resume_versions", op: "insert" }, { table: "tailoring_reports", op: "insert" }]);
    expect(snapshot(db, ["candidate_items", "resumes", "jobs"])).toEqual({ candidate_items: before.candidate_items, resumes: before.resumes, jobs: before.jobs });
    // the two versions that already existed are unchanged; one new row was appended
    expect(JSON.stringify(db.tables.resume_versions.slice(0, 2))).toBe(before.resume_versions);
    expect(db.tables.resume_versions).toHaveLength(3);
    expect(db.tables.resume_versions[2]).toMatchObject({ id: r.version.id, kind: "tailored", user_id: USER, job_id: JOB_ID, label: "Resume — Example Co", source_version_id: "master-1" });
    expect(db.tables.resume_versions[2].is_master).not.toBe(true); // a tailored version is never a master
  });

  it("PRESERVES THE ORIGINAL: the uploaded resume (its text and stored file) is exactly as uploaded", async () => {
    const original = JSON.stringify(db.tables.resumes[0]);
    await tailorResume(db as never, USER, { jobId: JOB_ID, accept: true });
    expect(JSON.stringify(db.tables.resumes[0])).toBe(original);
    expect(db.tables.resumes).toHaveLength(1);
    expect(db.log.some((l) => l.table === "resumes" && l.op !== "select")).toBe(false);
  });

  it("the master resume is never modified: same content, still the master", async () => {
    const master = JSON.stringify(db.tables.resume_versions[0]);
    await tailorResume(db as never, USER, { jobId: JOB_ID, accept: true });
    expect(JSON.stringify(db.tables.resume_versions[0])).toBe(master);
  });

  it("never silently overwrites: tailoring the same job again makes a second version and a second report, and the first is untouched", async () => {
    const first = created(await tailorResume(db as never, USER, { jobId: JOB_ID, accept: true }));
    const firstRow = JSON.stringify(db.tables.resume_versions.find((v) => v.id === first.version.id));
    const firstReport = JSON.stringify(db.tables.tailoring_reports[0]);
    const second = created(await tailorResume(db as never, USER, { jobId: JOB_ID, accept: true }));
    expect(second.version.id).not.toBe(first.version.id);
    expect(db.tables.resume_versions).toHaveLength(4);
    expect(db.tables.tailoring_reports).toHaveLength(2);
    expect(JSON.stringify(db.tables.resume_versions.find((v) => v.id === first.version.id))).toBe(firstRow);
    expect(JSON.stringify(db.tables.tailoring_reports[0])).toBe(firstReport);
  });
});

describe("the persisted report", () => {
  it("is stored with the version, the job, the master and a snapshot of the job's title and company — and equals the one returned", async () => {
    const r = created(await tailorResume(db as never, USER, { jobId: JOB_ID, accept: true }));
    expect(db.tables.tailoring_reports[0]).toMatchObject({ user_id: USER, version_id: r.version.id, job_id: JOB_ID, master_version_id: "master-1", job_title: "Software Engineering Intern", company_name: "Example Co" });
    expect(db.tables.tailoring_reports[0].report).toEqual(r.report);
  });
  it("says what matched, what is missing and was NOT added, every spelling change and that nothing is unsupported", async () => {
    const { report } = created(await tailorResume(db as never, USER, { jobId: JOB_ID, accept: true }));
    expect(report.missing).toEqual(expect.arrayContaining(["Docker", "Rust"]));
    expect(report.counts.missing).toBeGreaterThanOrEqual(2);
    expect(report.terminology.map((t) => t.to)).toEqual(expect.arrayContaining(["Node.js", "Kubernetes", "PostgreSQL"].filter((x) => x !== "PostgreSQL")));
    expect(report.unsupported).toEqual([]);
    expect(report.verification.ok).toBe(true);
    expect(report.baseline).toEqual({ source: "master", versionId: "master-1" });
  });
  it("without a master, the baseline is the profile and the report says so; the version is not linked to a master", async () => {
    db = seed();
    const r = created(await tailorResume(db as never, USER, { jobId: JOB_ID, accept: true }));
    expect(r.report.baseline).toEqual({ source: "profile", versionId: null });
    expect(r.report.notes.join(" ")).toMatch(/not set a master resume/);
    expect(db.tables.resume_versions[0].source_version_id).toBeNull();
    expect(db.tables.tailoring_reports[0].master_version_id).toBeNull();
  });
});

describe("truthfulness", () => {
  const stored = (r: ReturnType<typeof created>) => db.tables.resume_versions.find((v) => v.id === r.version.id)!.content as ResumeDoc;
  const textOf = (d: ResumeDoc) => JSON.stringify(d);

  it("a skill the job asks for and the profile lacks (Docker, Rust) is never written onto the resume", async () => {
    const r = created(await tailorResume(db as never, USER, { jobId: JOB_ID, accept: true }));
    expect(textOf(stored(r))).not.toMatch(/Docker|Rust/);
    expect(r.report.missing).toContain("Docker");
  });
  it("the stored resume passes the truth check, spelling changes and all", async () => {
    const r = created(await tailorResume(db as never, USER, { jobId: JOB_ID, accept: true }));
    expect(validateDoc(stored(r), ITEMS as CandidateItem[])).toEqual({ ok: true, issues: [] });
    expect(textOf(stored(r))).toContain("Node.js");
  });
  it("across many jobs and profile subsets: the tailored resume names no skill the profile does not, and adds no number", async () => {
    const jobs = [
      "Requirements: Node.js, Kubernetes, PostgreSQL, Python, SQL",
      "We use Rust, Go, C++, TensorFlow and Docker. Nice to have: Kubernetes.",
      "Full-stack: React, Next.js, TypeScript, MongoDB and AWS.",
      "Data role: pandas, NumPy, scikit-learn, PyTorch. 5+ years preferred. Salary 120000.",
      "Senior 10 years experience with Java and Spring Boot.",
    ];
    const subsets = [ITEMS, ITEMS.filter((_, i) => i % 2 === 0 || i < 3), ITEMS.slice(0, 7), ITEMS.filter((i) => i.section !== "skill")];
    let ran = 0;
    for (const description of jobs) {
      for (const subset of subsets) {
        db = seed();
        db.tables.candidate_items = structuredClone(subset) as never;
        db.tables.jobs = [job({ description, job_requirements: [] })] as never;
        if (!subset.some((i) => i.section === "experience" || i.section === "skill")) continue;
        const r = created(await tailorResume(db as never, USER, { jobId: JOB_ID, accept: true }));
        const profileText = subset.map((i) => JSON.stringify(i.data)).join("\n");
        const tailoredText = textOf(stored(r));
        const allowed = new Set(extractSkills(profileText));
        for (const s of extractSkills(tailoredText.replace(/"(?:id|sourceItemId)":"[^"]*",?/g, ""))) expect(allowed.has(s), `${s} was added for: ${description}`).toBe(true);
        const nums = (t: string) => new Set((t.match(/\d{2,}/g) ?? []).filter((x) => !/^20\d\d$/.test(x)));
        for (const num of nums(tailoredText.replace(/"(?:id|sourceItemId)":"[^"]*",?/g, ""))) expect(nums(profileText).has(num) || profileText.includes(num), `number ${num} was added`).toBe(true);
        ran++;
      }
    }
    expect(ran).toBeGreaterThan(12);
  });
});

describe("what it refuses to do, and what it cleans up", () => {
  it("a resume that fails verification is never saved (HTTP 422, no version, no report)", async () => {
    vi.mocked(validateDoc).mockReturnValueOnce({ ok: false, issues: [{ where: "Experience", text: "x", claim: "Rust", reason: "No supporting evidence found in your profile." }] });
    await expect(tailorResume(db as never, USER, { jobId: JOB_ID, accept: true })).rejects.toMatchObject({ status: 422, message: expect.stringContaining("Rust") });
    expect(writes(db)).toEqual([]);
  });
  it("if the report cannot be saved, the version created a moment ago is removed and the error is raised — never an unreported tailored resume", async () => {
    const failing = { ...db, from: (t: string) => (t === "tailoring_reports" ? { insert: async () => ({ error: { message: "disk full" } }) } : db.from(t)) };
    await expect(tailorResume(failing as never, USER, { jobId: JOB_ID, accept: true })).rejects.toMatchObject({ message: "disk full" });
    expect(db.tables.resume_versions.map((v) => v.id)).toEqual(["master-1", "old-tailored"]); // only the new one was removed
    expect(db.tables.tailoring_reports).toEqual([]);
  });
  it("without a confirmed profile it asks you to upload and review first (HTTP 400)", async () => {
    db = seed();
    db.tables.candidate_items = ITEMS.map((i) => ({ ...i, status: "requires_confirmation" })) as never;
    await expect(tailorResume(db as never, USER, { jobId: JOB_ID, accept: true })).rejects.toMatchObject({ status: 400 });
  });
  it("an unknown job is a 404", async () => {
    await expect(tailorResume(db as never, USER, { jobId: "99999999-9999-4999-8999-999999999999", accept: true })).rejects.toMatchObject({ status: 404 });
  });
  it("only exclusions of items that exist in the profile are honoured; the rest are ignored", async () => {
    const libraryId = ITEMS.find((i) => (i.data as { organization?: string }).organization === "SJSU Library")!.id;
    const r = created(await tailorResume(db as never, USER, { jobId: JOB_ID, accept: true, exclude: [libraryId, "22222222-2222-4222-8222-222222222222"] }));
    const doc = db.tables.resume_versions.find((v) => v.id === r.version.id)!.content as ResumeDoc;
    expect(JSON.stringify(doc)).not.toContain("SJSU Library");
    expect(r.report.changedSections.find((c) => c.title === "Experience")?.changes).toContain("entries removed");
    // the profile itself still has it
    expect(db.tables.candidate_items.some((i) => (i.data as { organization?: string }).organization === "SJSU Library")).toBe(true);
  });
});

// type-only use so the report shape stays covered by the compiler here
export type _R = TailoringReport;

describe("excluded jobs (campus hunter)", () => {
  it("a dining job is refused for tailoring, in preview and on accept, and nothing is written", async () => {
    const d = seed({ jobs: [job({ title: "Dining Commons Cook", excluded_reason: "dining: The title names dining and food service work (“cook”)." })] as never });
    await expect(tailorResume(d as never, USER, { jobId: JOB_ID })).rejects.toMatchObject({ status: 409 });
    await expect(tailorResume(d as never, USER, { jobId: JOB_ID, accept: true })).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/does not tailor resumes/) });
    expect(writes(d)).toEqual([]);
  });
});
