/**
 * Who submits an application. Here, always the student.
 *
 * No source FRIDAY reads has been checked for whether it permits automated submission, and FRIDAY has no integration that
 * submits to any of them. So the policy is a constant, not a per-source switch that someone could flip on an assumption:
 * every source is "assisted only" — FRIDAY prepares, the student submits on the employer's own site.
 *
 * If a source is ever verified to allow it (in writing, from the employer or the platform), that decision belongs to the
 * student and the project owner, and this file is where it would be recorded, with the evidence.
 */
export type SubmissionPolicy = { mode: "assisted_only"; automated: false; reason: string };

export function submissionPolicy(source: string | null): SubmissionPolicy {
  return {
    mode: "assisted_only",
    automated: false,
    reason: `FRIDAY does not submit applications${source ? ` (source: ${source})` : ""}. It has not been checked whether any source permits automated submission, so you submit on the employer's own site yourself.`,
  };
}
