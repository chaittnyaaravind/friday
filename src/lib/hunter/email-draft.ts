/**
 * The email an approved application is sent with, built ONLY from the student's profile fields and the posting's title.
 * No AI, no claims: who they are, what they are applying for, that the resume is attached, their stated availability.
 * If the student wrote a cover letter for this application, that is the body instead. Pure.
 */
export type DraftProfile = { fullName: string | null; university: string | null; major: string | null; graduationYear: number | null; availability: string | null; email: string | null };

export function applicationEmail(p: DraftProfile, job: { title: string; employer: string }, coverLetter: string | null): { subject: string; body: string } {
  const name = p.fullName?.trim() || null;
  const subject = `Application: ${job.title}${name ? ` — ${name}` : ""}`.slice(0, 180);
  if (coverLetter?.trim()) return { subject, body: coverLetter.trim() };

  const who = [p.major?.trim() && `${p.major.trim()} student`, p.university?.trim() && `at ${p.university.trim()}`].filter(Boolean).join(" ");
  const grad = p.graduationYear ? ` graduating in ${p.graduationYear}` : "";
  const lines = [
    "Hello,",
    "",
    `I would like to apply for the ${job.title} position with ${job.employer}. My resume is attached.`,
    who ? `I am a ${who}${grad}.` : null,
    p.availability?.trim() ? `My availability: ${p.availability.trim()}.` : null,
    "",
    "Thank you for your time. I look forward to hearing from you.",
    "",
    "Best regards,",
    name ?? "",
    p.email ?? "",
  ];
  return { subject, body: lines.filter((l) => l !== null).join("\n").replace(/\.\.$/gm, ".").trim() };
}
