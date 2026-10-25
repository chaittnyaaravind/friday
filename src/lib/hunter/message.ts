/**
 * The Telegram messages the hunter sends. Pure: data in, { text, buttons } out (Telegram HTML, under its 4,096-char limit).
 *
 * The job card must let the student decide from their phone: what the job is, whether it is desk work and why, pay, how
 * their resume was tailored and how it measures up, and EXACTLY what "Approve" will do — including the email text that
 * will be sent and every confirmation the approval counts as ticking. Nothing is stated that FRIDAY did not read.
 */
import { CONFIRM_TEXT } from "@/lib/apply/packet";
import { LEVEL_LABEL, type PhysicalLevel } from "@/lib/domain/physical";
import type { ApplyChannel } from "./apply-channel";

export type Button = { text: string; data?: string; url?: string };
export type TgMessage = { text: string; buttons: Button[][] };

export type HuntCard = {
  itemId: string;
  job: { title: string; employer: string; payText: string | null; physical: PhysicalLevel; physicalWhy: string[]; deskWhy: string[]; source: string; url: string | null; deadline: string | null };
  score: number | null;
  research: { summary: string; required: string[] } | null;
  resume: { label: string; matched: number; total: number; missing: string[]; changes: string[]; verified: boolean; rewrites?: { where: string; after: string }[]; parse?: string | null } | null;
  /** What the posting screens for and whether the profile shows it (campus-screens.ts). */
  screens?: { label: string; covered: "yes" | "no" | "check" }[];
  channel: ApplyChannel;
  email: { to: string; subject: string; body: string } | null;
  confirmations: string[];
  blockers: string[];
  appUrl: string;
};

const MAX = 4000;
/** Telegram rejects a whole message if any button URL is not absolute http(s) (a mailto: apply link, an unset site URL). */
export const buttonUrl = (u: string | null | undefined): string | null => {
  try {
    const url = new URL(u ?? "");
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
};
/** Rows with any unusable URL button dropped from them; empty rows removed. */
const safeRows = (rows: Button[][]): Button[][] => rows.map((r) => r.filter((b) => !b.url || buttonUrl(b.url))).filter((r) => r.length);
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function huntCard(c: HuntCard): TgMessage {
  const L: string[] = [];
  L.push(`🆕 <b>${esc(c.job.title)}</b>`, esc(c.job.employer));
  const facts = [c.job.payText ? `💵 ${esc(c.job.payText)}` : "💵 pay not stated", `🪑 ${esc(LEVEL_LABEL[c.job.physical])}`, c.score != null ? `🎯 ${c.score}% fit` : null, c.job.deadline ? `⏳ apply by ${esc(c.job.deadline)}` : null];
  L.push(facts.filter(Boolean).join(" · "));
  if (c.job.deskWhy.length) L.push(`Desk work: ${esc(c.job.deskWhy.slice(0, 4).join(", "))}`);
  if (c.job.physicalWhy.length) L.push(`Physical: ${esc(c.job.physicalWhy.slice(0, 3).join("; "))}`);
  L.push(`Source: ${esc(c.job.source)}`);

  if (c.research) {
    L.push("", "<b>What it is</b>", esc(clip(c.research.summary, 400)));
    if (c.research.required.length) L.push(`Asks for: ${esc(c.research.required.slice(0, 8).join(", "))}`);
  }

  if (c.resume) {
    L.push("", `<b>Your resume</b> — ${esc(c.resume.label)}${c.resume.verified ? " ✅ every line checked against your profile" : " ⚠️ not verified"}`);
    if (c.resume.total) L.push(`Covers ${c.resume.matched} of ${c.resume.total} things the posting asks for.`);
    if (c.resume.changes.length) L.push(`Tailored: ${esc(clip(c.resume.changes.slice(0, 3).join("; "), 300))}`);
    if (c.resume.rewrites?.length) {
      L.push(`✍️ ${c.resume.rewrites.length} line${c.resume.rewrites.length === 1 ? "" : "s"} rewritten in the posting's terms (fact-checked, nothing added), e.g.:`);
      L.push(`<i>${esc(clip(c.resume.rewrites[0].after, 220))}</i>`);
    }
    if (c.resume.parse) L.push(`🧾 ${esc(c.resume.parse)}`);
    if (c.resume.missing.length) L.push(`Not on your profile (left out, never invented): ${esc(c.resume.missing.slice(0, 5).join(", "))}`);
  } else L.push("", "⚠️ No tailored resume: upload and review your resume in FRIDAY first.");
  if (c.screens?.length) {
    const mark = { yes: "✅", no: "❌", check: "❔" } as const;
    L.push(`Screens for: ${c.screens.slice(0, 8).map((s) => `${mark[s.covered]} ${esc(s.label)}`).join(" · ")}`);
  }

  L.push("");
  if (c.blockers.length) {
    L.push("⛔ <b>Can't approve yet</b>", ...c.blockers.slice(0, 4).map((b) => `• ${esc(b)}`));
  } else if (c.channel.kind === "email" && c.email) {
    L.push(`<b>Approve = send this from your Gmail</b> to ${esc(c.email.to)}, with your resume attached as a PDF:`, `<i>${esc(c.email.subject)}</i>`, `<blockquote>${esc(clip(c.email.body, 900))}</blockquote>`);
  } else {
    L.push("<b>Approve = FRIDAY sends you the resume PDF and the official link</b>; you submit there, then tap “I applied”.");
    if (c.channel.kind === "site") L.push(esc(c.channel.reason));
  }
  if (!c.blockers.length && c.confirmations.length) L.push("", "Approving also confirms:", ...c.confirmations.map((k) => `• ${esc(CONFIRM_TEXT[k] ?? k)}`));

  let text = L.join("\n");
  // Every part is clipped above, so this is a backstop. Tags are dropped first so a cut never leaves broken HTML.
  if (text.length > MAX) text = `${text.replace(/<\/?(?:b|i|blockquote)>/g, "").slice(0, MAX - 1).replace(/&[a-z]*$/, "")}…`;

  const buttons: Button[][] = [];
  if (!c.blockers.length && c.resume) buttons.push([{ text: c.channel.kind === "email" ? "✅ Approve & send" : "✅ Approve", data: `ap:${c.itemId}` }]);
  buttons.push([{ text: "📄 Review in FRIDAY", url: c.appUrl }, ...(c.job.url ? [{ text: "🔗 Posting", url: c.job.url }] : [])]);
  buttons.push([{ text: "⏭ Skip", data: `sk:${c.itemId}` }]);
  return { text, buttons: safeRows(buttons) };
}

export const sentNotice = (o: { title: string; employer: string; to: string; at: string }): TgMessage => ({
  text: `✅ <b>Sent</b> — ${esc(o.title)} (${esc(o.employer)})\nFrom your Gmail to ${esc(o.to)} at ${esc(o.at)}.\nMarked “applied” in your tracker; FRIDAY will remind you to follow up in a week.`,
  buttons: [],
});

export const handOffNotice = (o: { itemId: string; title: string; url: string; reason: string | null }): TgMessage => ({
  text: `👍 Approved — ${esc(o.title)}\nYour tailored resume is attached.${o.reason ? `\n${esc(o.reason)}` : ""}\nSubmit on the official page, then tap “I applied”.${buttonUrl(o.url) ? "" : `\nApply here: ${esc(o.url)}`}`,
  buttons: safeRows([[{ text: "🔗 Open the application", url: o.url }], [{ text: "📨 I applied", data: `dn:${o.itemId}` }]]),
});

export type OpenJob = { id: string; title: string; company: string; deadline: string | null; desk: boolean };

/** Reply to /open: how many SJSU jobs are open to apply right now, per employer, with the desk jobs listed. Counted, never estimated. */
export function openJobsNotice(o: { open: number; desk: number; byEmployer: { company: string; open: number; desk: number }[] }, jobs: OpenJob[], appUrl: string): TgMessage {
  const L: string[] = [];
  L.push(`📋 <b>${o.open} SJSU job${o.open === 1 ? "" : "s"} open to apply now</b> · ${o.desk} desk`);
  if (o.byEmployer.length) L.push(esc(o.byEmployer.map((e) => `${e.company.replace(/^SJSU /, "")} ${e.open}${e.desk ? ` (${e.desk} desk)` : ""}`).join(" · ")));
  const desk = jobs.filter((j) => j.desk);
  if (desk.length) {
    L.push("", "<b>Desk jobs</b>");
    for (const j of desk.slice(0, 15)) L.push(`• <a href="${esc(`${appUrl}/jobs/${j.id}`)}">${esc(clip(j.title, 70))}</a> · ${esc(j.company.replace(/^SJSU /, ""))}${j.deadline ? ` · by ${esc(j.deadline.slice(0, 10))}` : ""}`);
  }
  L.push("", "Counted from SJSU's official hiring pages FRIDAY reads every 5 minutes. Handshake-only postings arrive through your alert emails.");
  return { text: clip(L.join("\n"), MAX), buttons: safeRows([[{ text: "Open SJSU jobs in FRIDAY", url: `${appUrl}/sjsu` }]]) };
}
