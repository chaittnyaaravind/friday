import { z } from "zod";
import { body, HttpError, ok, withUser } from "@/lib/api";
import { draftAnswer } from "@/lib/ai/tasks";
import { ANSWER_DRAFT_TITLE, classifyQuestion, DECLARATION_LABEL } from "@/lib/apply/questions";
import { unsupportedClaims } from "@/lib/resume/validate";
import { loadProfileItems } from "@/lib/resume/profile";
import { isEligible } from "@/lib/resume/types";
import { hasBlockingIssue, lintWriting } from "@/lib/writing/style";

const Input = z.object({ question: z.string().trim().min(3).max(500) });

/**
 * POST /api/applications/:id/answers — DRAFT one application answer from your approved profile facts.
 *
 * Refused (422) for personal declarations — work authorization, sponsorship, availability, employment history,
 * disability, demographics and the like — which you always answer yourself. A draft that states a number or a
 * technology your profile does not support, or claims a scope your profile does not state, is discarded, never shown.
 * The draft is saved as a document so the packet can tell it apart from your own words; nothing is sent anywhere.
 */
export const POST = withUser<{ id: string }>(async ({ db, user, req }, { id }) => {
  const { question } = await body(req, Input);
  const kind = classifyQuestion(question);
  if (kind.sensitive) {
    throw new HttpError(422, `This asks for a personal declaration (${DECLARATION_LABEL[kind.kind].toLowerCase()}). ${kind.reason} Write this answer yourself.`);
  }

  const { data: app } = await db.from("applications").select("id, company_name, job_title, jobs(description, excluded_reason)").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!app) throw new HttpError(404, "Application not found");
  const job = app.jobs as unknown as { description: string | null; excluded_reason: string | null } | null;
  if (job?.excluded_reason) throw new HttpError(409, "This job is excluded by FRIDAY's job-search rules, so FRIDAY does not prepare answers for it.");

  // Only confirmed profile facts are given to the model, and the same facts are the evidence the draft is checked against.
  const items = (await loadProfileItems(db, user.id)).filter(isEligible);
  if (!items.length) throw new HttpError(400, "Upload and review your resume first, so FRIDAY has facts to draft from.");
  const facts = items.map((i) => ({ section: i.section, ...(i.data as object) }));
  const evidence = items.map((i) => `${JSON.stringify(i.data)}\n${i.source_text ?? ""}`).join("\n");

  const draft = await draftAnswer(question, facts, { title: app.job_title, company: app.company_name, description: job?.description ?? "" });
  const answer = draft.answer.trim();
  if (!answer) return ok({ answer: null, missing: draft.missing ?? "Your profile does not contain the facts this question asks about.", issues: [] });

  const unsupported = unsupportedClaims(answer, evidence);
  const issues = lintWriting(answer, "answer", evidence);
  if (unsupported.length || hasBlockingIssue(issues)) {
    const why = unsupported.length ? `it stated ${unsupported.map((c) => `“${c}”`).join(", ")}, which your profile does not support` : issues.find((i) => i.severity === "error")!.message;
    throw new HttpError(422, `FRIDAY discarded the draft because ${why}. Write this answer yourself, or add the real facts to your profile first.`);
  }

  await db.from("application_documents").insert({ application_id: id, user_id: user.id, kind: "other", title: `${ANSWER_DRAFT_TITLE}${question}`.slice(0, 300), content: answer });
  await db.from("application_events").insert({ application_id: id, user_id: user.id, kind: "document", note: "Answer drafted from profile facts" });
  return ok({ answer, missing: draft.missing, groundedIn: draft.grounded_in, issues: issues.filter((i) => i.severity === "warn") });
});
