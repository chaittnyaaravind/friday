/**
 * The application packet: everything FRIDAY has prepared for ONE application, as one plain, hashable record.
 *
 * FRIDAY does not submit applications. It prepares a packet, shows the student exactly what is in it, and hands them the
 * official application only after they explicitly approve THIS content. The rules, each tested:
 *   - The approval is bound to a hash of the exact content (resume text, cover letter, answers, apply link). Change any of
 *     it and the approval no longer matches — the student must look again and approve again.
 *   - Nothing is invented. An answer FRIDAY does not have is "missing", never filled in. The live application form is not
 *     read, so a question FRIDAY did not prepare for is reported by the student and answered by the student.
 *   - Blockers stop approval; "confirm" items need a tick from the student; nothing here ever calls an external service.
 */
import { createHash } from "node:crypto";
import type { EligibilityResult } from "@/lib/domain/eligibility";
import { todayISODate } from "@/lib/domain/hunt";
import { docToText } from "@/lib/resume/generate";
import type { ResumeDoc } from "@/lib/resume/types";
import type { Issue } from "@/lib/resume/validate";
import { submissionPolicy } from "./policy";
import { classifyQuestion, DECLARATION_LABEL } from "./questions";

export type AnswerSource = "profile" | "resume" | "student" | "missing";
export type PacketAnswer = { key: string; label: string; value: string | null; source: AnswerSource };
/**
 * A question the application asks that FRIDAY has no prepared answer for. The student reports it and writes the answer,
 * or (for questions that are not personal declarations) asks FRIDAY for a draft from approved facts. `origin` is decided
 * by the server: an answer that is exactly a saved AI draft is "ai_draft", anything else the student's own.
 */
export type ExtraQuestion = { question: string; answer: string | null; origin?: "student" | "ai_draft" };
export type DocumentNeed = { kind: "cover_letter" | "transcript" | "references" | "writing_sample" | "portfolio"; mention: string; required: boolean; state: "in_packet" | "missing" | "you_provide" };

export type PacketJob = { id: string; title: string; company: string; status: string; deadline: string | null; applyUrl: string | null; source: string | null; official: boolean };
export type PacketProfile = {
  name: string | null; email: string | null; phone: string | null; location: string | null; university: string | null; major: string | null;
  graduationYear: number | null; gpa: number | null; workAuthorization: string | null; availability: string | null; github: string | null; linkedin: string | null; portfolio: string | null;
};

export type PacketInput = {
  job: PacketJob;
  description: string | null;
  profile: PacketProfile;
  resume: { versionId: string; label: string; kind: string; doc: ResumeDoc; verified: { ok: boolean; issues: Issue[] } } | null;
  coverLetter: { text: string; origin: "student" | "ai_draft" } | null;
  eligibility: EligibilityResult | null;
  extra: ExtraQuestion[];
  builtAt: string;
};

/** The stored snapshot. Immutable once saved: a change is a NEW packet. */
export type Packet = {
  version: 1;
  builtAt: string;
  job: PacketJob;
  resume: { versionId: string; label: string; kind: string; text: string; verified: { ok: boolean; issues: Issue[] } } | null;
  coverLetter: { text: string; origin: "student" | "ai_draft" } | null;
  answers: PacketAnswer[];
  extra: ExtraQuestion[];
  documents: DocumentNeed[];
  eligibility: { verdict: string; headline: string } | null;
};

// ───────────────────────── what the posting asks for ─────────────────────────

const DOCS: { kind: DocumentNeed["kind"]; re: RegExp }[] = [
  { kind: "cover_letter", re: /cover\s+letter/i },
  { kind: "transcript", re: /\b(?:unofficial\s+|official\s+)?transcripts?\b/i },
  { kind: "references", re: /\b(?:references|letters?\s+of\s+recommendation|recommendation\s+letters?)\b/i },
  { kind: "writing_sample", re: /writing\s+sample/i },
  { kind: "portfolio", re: /\bportfolio\b/i },
];
const REQUIRED_NEAR = /\b(?:required|must|please\s+(?:include|attach|submit|provide)|should\s+(?:include|attach)|need(?:s|ed)?\s+to|submit)\b/i;
const excerpt = (text: string, at: number, len: number) => text.slice(Math.max(0, at - 70), Math.min(text.length, at + len + 70)).replace(/\s+/g, " ").trim();

/** Documents the posting's own words mention. FRIDAY cannot see the live form, so this is what the POSTING says, nothing more. */
export function documentsAsked(description: string | null, hasCoverLetter: boolean): DocumentNeed[] {
  const text = description ?? "";
  const out: DocumentNeed[] = [];
  for (const d of DOCS) {
    const m = d.re.exec(text);
    if (!m) continue;
    const near = excerpt(text, m.index, m[0].length);
    const required = REQUIRED_NEAR.test(near);
    out.push({ kind: d.kind, mention: near, required, state: d.kind === "cover_letter" ? (hasCoverLetter ? "in_packet" : "missing") : "you_provide" });
  }
  return out;
}

// ───────────────────────── building ─────────────────────────

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
const WORK_AUTH: Record<string, string> = {
  us_citizen: "U.S. citizen", permanent_resident: "Permanent resident", f1: "F-1 student visa", f1_opt: "F-1 OPT", f1_cpt: "F-1 CPT", h1b: "H-1B", other: "Other", need_sponsorship: "Requires sponsorship",
};

export function buildPacket(i: PacketInput): Packet {
  const p = i.profile;
  const ans = (key: string, label: string, value: string | null | undefined, source: AnswerSource = "profile"): PacketAnswer => {
    const v = clean(value);
    return { key, label, value: v, source: v ? source : "missing" };
  };
  const answers: PacketAnswer[] = [
    ans("name", "Full name", p.name),
    ans("email", "Email", p.email),
    ans("phone", "Phone", p.phone),
    ans("location", "Location", p.location),
    ans("school", "School", p.university),
    ans("major", "Major", p.major),
    ans("graduation", "Expected graduation", p.graduationYear ? String(p.graduationYear) : null),
    ans("gpa", "GPA", p.gpa != null ? p.gpa.toFixed(2) : null),
    ans("work_authorization", "Work authorization", p.workAuthorization ? WORK_AUTH[p.workAuthorization] ?? p.workAuthorization : null),
    ans("availability", "Availability", p.availability),
    ans("github", "GitHub", p.github),
    ans("linkedin", "LinkedIn", p.linkedin),
    ans("portfolio", "Portfolio", p.portfolio),
  ];
  const cover = i.coverLetter && clean(i.coverLetter.text) ? { text: i.coverLetter.text.trim(), origin: i.coverLetter.origin } : null;
  return {
    version: 1,
    builtAt: i.builtAt,
    job: i.job,
    resume: i.resume ? { versionId: i.resume.versionId, label: i.resume.label, kind: i.resume.kind, text: docToText(i.resume.doc), verified: i.resume.verified } : null,
    coverLetter: cover,
    answers,
    extra: i.extra.map((e) => ({ question: e.question.trim(), answer: clean(e.answer), origin: e.origin ?? "student" })).filter((e) => e.question),
    documents: documentsAsked(i.description, Boolean(cover)),
    eligibility: i.eligibility ? { verdict: i.eligibility.verdict, headline: i.eligibility.headline } : null,
  };
}

// ───────────────────────── the hash the approval is bound to ─────────────────────────

const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
};

/**
 * sha256 over exactly what would be submitted: the apply link, the resume (which version and its text), the cover letter,
 * every answer and every extra answer. NOT the build time, the eligibility note or the posting's document hints — those can
 * change without changing what the student is sending, and must not invalidate an approval.
 */
export function packetHash(p: Packet): string {
  const sent = {
    applyUrl: p.job.applyUrl,
    job: p.job.id,
    resume: p.resume ? { id: p.resume.versionId, text: p.resume.text } : null,
    coverLetter: p.coverLetter?.text ?? null,
    answers: p.answers.map((a) => [a.key, a.value]),
    extra: p.extra.map((e) => [e.question, e.answer]),
  };
  return createHash("sha256").update(canonical(sent)).digest("hex");
}

// ───────────────────────── blockers, confirmations, readiness ─────────────────────────

export type Severity = "block" | "confirm" | "info";
export type PacketIssue = { code: string; severity: Severity; message: string };

export const CONFIRM_TEXT: Record<string, string> = {
  eligibility_verify: "I have read the eligibility notes and checked they do not stop me from applying.",
  eligibility_blocked: "FRIDAY thinks I am likely not eligible. I have checked, and I still want to apply.",
  authorization_unclear: "My work authorization is not on my profile. I will answer that question myself on the application.",
  ai_cover_letter: "I have read this cover letter, which an AI drafted, and every statement in it is true.",
  personal_declarations: "I answered the personal-declaration questions (work authorization, availability, and similar) myself, and my answers are accurate.",
  ai_answers: "I have read every AI-drafted answer, and every statement in them is true.",
};

/** Every reason this packet cannot yet be approved, needs a tick, or is worth knowing. Deterministic. */
export function assessPacket(p: Packet, now: number): PacketIssue[] {
  const out: PacketIssue[] = [];
  const add = (code: string, severity: Severity, message: string) => out.push({ code, severity, message });
  const today = todayISODate(now);

  if (p.job.status !== "active") add("job_not_open", "block", `This opportunity is ${p.job.status === "closed" || p.job.status === "archived" ? "no longer listed as open" : `marked ${p.job.status}`}, so there is nothing to apply to.`);
  if (p.job.deadline && p.job.deadline.slice(0, 10) < today) add("deadline_passed", "block", `The deadline (${p.job.deadline.slice(0, 10)}) has passed.`);
  if (!p.job.applyUrl) add("no_apply_url", "block", "There is no application link for this opportunity, so FRIDAY has nowhere to hand you to.");
  if (!p.resume) add("missing_resume", "block", "Choose the resume you will send.");
  else if (!p.resume.verified.ok) {
    const n = p.resume.verified.issues.length;
    add("resume_unverified", "block", `${n} line${n === 1 ? "" : "s"} on this resume ${n === 1 ? "has" : "have"} no supporting evidence in your profile. Fix or remove ${n === 1 ? "it" : "them"} in the resume editor.`);
  }
  for (const key of ["name", "email"]) {
    const a = p.answers.find((x) => x.key === key);
    if (!a?.value) add(`missing_${key}`, "block", `Your ${a?.label.toLowerCase() ?? key} is missing. Add it to your profile — FRIDAY will not guess it.`);
  }
  const unanswered = p.extra.filter((e) => !e.answer);
  if (unanswered.length) add("unexpected_question", "block", `You reported ${unanswered.length === 1 ? "a question" : `${unanswered.length} questions`} FRIDAY has no prepared answer for: “${unanswered[0].question}”. Write your own answer, or remove it.`);
  // Personal declarations (apply/questions.ts) are the student's own words, always. An AI draft there is a blocker, not a tick.
  const declarations = p.extra.filter((e) => classifyQuestion(e.question).sensitive);
  const aiDeclaration = declarations.find((e) => e.answer && e.origin === "ai_draft");
  if (aiDeclaration) {
    const c = classifyQuestion(aiDeclaration.question);
    add("ai_declaration", "block", `“${aiDeclaration.question}” asks for a personal declaration${c.sensitive ? ` (${DECLARATION_LABEL[c.kind].toLowerCase()})` : ""}. Write that answer yourself; FRIDAY will not answer it for you.`);
  }
  for (const d of p.documents) {
    if (d.kind === "cover_letter" && d.required && d.state === "missing") add("cover_letter_missing", "block", "The posting asks for a cover letter. Write one, or have FRIDAY draft one for you to review.");
    if (d.kind !== "cover_letter" && d.required) add(`you_provide_${d.kind}`, "info", `The posting asks for ${d.kind.replace("_", " ")}. FRIDAY cannot prepare this; you will attach it yourself.`);
  }

  if (p.eligibility?.verdict === "blocked") add("eligibility_blocked", "confirm", p.eligibility.headline);
  else if (p.eligibility?.verdict === "verify") add("eligibility_verify", "confirm", p.eligibility.headline);
  if (!p.answers.find((a) => a.key === "work_authorization")?.value) add("authorization_unclear", "confirm", "Your work authorization is not on your profile, and applications often ask.");
  if (p.coverLetter?.origin === "ai_draft") add("ai_cover_letter", "confirm", "The cover letter was drafted by AI from your profile. FRIDAY does not verify it line by line.");
  if (declarations.some((e) => e.answer)) add("personal_declarations", "confirm", `${declarations.length === 1 ? "One answer is" : `${declarations.length} answers are`} a personal declaration (${[...new Set(declarations.map((e) => { const c = classifyQuestion(e.question); return c.sensitive ? DECLARATION_LABEL[c.kind].toLowerCase() : ""; }))].join(", ")}). Only you can vouch for ${declarations.length === 1 ? "it" : "them"}.`);
  if (p.extra.some((e) => e.answer && e.origin === "ai_draft" && !classifyQuestion(e.question).sensitive)) add("ai_answers", "confirm", "Some answers were drafted by AI from your approved profile facts. Read each one before you approve.");

  add("source_policy", "info", submissionPolicy(p.job.source).reason);
  return out;
}

export type Readiness = "blocked" | "needs_confirmation" | "ready_for_approval";
export const confirmationsNeeded = (issues: PacketIssue[]) => issues.filter((i) => i.severity === "confirm").map((i) => i.code);
export function readiness(issues: PacketIssue[], acknowledged: string[]): Readiness {
  if (issues.some((i) => i.severity === "block")) return "blocked";
  return confirmationsNeeded(issues).every((c) => acknowledged.includes(c)) ? "ready_for_approval" : "needs_confirmation";
}

// ───────────────────────── approval ─────────────────────────

export type Approval = { contentHash: string; acknowledged: string[]; approvedAt: string };
export type ApprovalState =
  | { state: "none" }
  | { state: "approved"; approvedAt: string }
  /** An approval exists but for different content — the student must look and approve again. */
  | { state: "stale"; approvedAt: string };

/** An approval counts only for the exact content it was given for. */
export function approvalState(p: Packet, approval: Approval | null): ApprovalState {
  if (!approval) return { state: "none" };
  return approval.contentHash === packetHash(p) ? { state: "approved", approvedAt: approval.approvedAt } : { state: "stale", approvedAt: approval.approvedAt };
}

/**
 * May the student be handed to the official application right now? Re-checks everything at the moment of the click: the job
 * may have closed, or the deadline passed, since the packet was approved.
 */
export function canHandOff(p: Packet, approval: Approval | null, now: number): { ok: true } | { ok: false; reason: string } {
  const state = approvalState(p, approval);
  if (state.state === "none") return { ok: false, reason: "Approve the packet first." };
  if (state.state === "stale") return { ok: false, reason: "The packet changed after you approved it. Review it and approve again." };
  const blocker = assessPacket(p, now).find((i) => i.severity === "block");
  if (blocker) return { ok: false, reason: blocker.message };
  return { ok: true };
}

/** Can this approval be recorded? The client's hash and ticks are checked against the stored packet — never trusted. */
export function validateApproval(p: Packet, claimedHash: string, acknowledged: string[], now: number): { ok: true; contentHash: string } | { ok: false; reason: string } {
  const contentHash = packetHash(p);
  if (claimedHash !== contentHash) return { ok: false, reason: "What you approved is not what is now saved. Reload and review the packet." };
  const issues = assessPacket(p, now);
  const blocker = issues.find((i) => i.severity === "block");
  if (blocker) return { ok: false, reason: blocker.message };
  const missing = confirmationsNeeded(issues).filter((c) => !acknowledged.includes(c));
  if (missing.length) return { ok: false, reason: `Tick each confirmation first (${missing.length} remaining).` };
  return { ok: true, contentHash };
}
