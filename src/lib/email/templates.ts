/**
 * Email templates. Pure functions: data in, { subject, html, text } out. Every dynamic value is HTML-escaped,
 * every message carries an unsubscribe link, and copy states only what FRIDAY actually knows.
 */
export type Mail = { subject: string; html: string; text: string };
export type MailContext = { siteUrl: string; unsubscribeUrl: string; name?: string | null };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles", timeZoneName: "short" });
const hello = (c: MailContext) => (c.name?.trim() ? `Hi ${c.name.trim().split(/\s+/)[0]},` : "Hi,");

function layout(c: MailContext, preheader: string, bodyHtml: string): string {
  const site = c.siteUrl.replace(/\/+$/, "");
  return `<!doctype html><html><body style="margin:0;background:#f5f1ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2a1d16">
<span style="display:none;max-height:0;overflow:hidden">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fffdf9;border-radius:16px;padding:32px">
<tr><td style="font-size:13px;letter-spacing:.18em;font-weight:600">FRIDAY</td></tr>
<tr><td style="padding-top:20px;font-size:15px;line-height:1.55">${bodyHtml}</td></tr>
<tr><td style="padding-top:28px;font-size:12px;line-height:1.6;color:#8a7b70">
You're getting this because of your FRIDAY notification settings.
<a href="${esc(site)}/settings" style="color:#8a7b70">Change preferences</a> ·
<a href="${esc(c.unsubscribeUrl)}" style="color:#8a7b70">Unsubscribe from all email</a>
</td></tr></table></td></tr></table></body></html>`;
}

const button = (href: string, label: string) => `<a href="${esc(href)}" style="display:inline-block;background:#c2410c;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-size:14px;font-weight:600">${esc(label)}</a>`;
const footerText = (c: MailContext) => `\n\nPreferences: ${c.siteUrl.replace(/\/+$/, "")}/settings\nUnsubscribe: ${c.unsubscribeUrl}\n`;

export type MatchJob = { id: string; title: string; company: string; location: string | null; score: number };

export function newMatchesEmail(c: MailContext, jobs: MatchJob[]): Mail {
  const site = c.siteUrl.replace(/\/+$/, "");
  const n = jobs.length;
  const subject = `${n} new ${n === 1 ? "opportunity matches" : "opportunities match"} your profile`;
  const rows = jobs.map((j) => `<tr><td style="padding:10px 0;border-top:1px solid #eee5d8"><a href="${esc(site)}/jobs/${esc(j.id)}" style="color:#2a1d16;font-weight:600;text-decoration:none">${esc(j.title)}</a><br><span style="color:#6f6157;font-size:13px">${esc(j.company)}${j.location ? ` · ${esc(j.location)}` : ""} · ${j.score}% match</span></td></tr>`).join("");
  const html = layout(c, subject, `<p>${esc(hello(c))}</p><p>FRIDAY found ${n} new ${n === 1 ? "opportunity" : "opportunities"} that fit your profile. Open one to see exactly why it matches and what's missing.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table><p style="padding-top:16px">${button(`${site}/discover?posted=1`, "See all new matches")}</p>`);
  const text = `${hello(c)}\n\nFRIDAY found ${n} new ${n === 1 ? "opportunity" : "opportunities"} that fit your profile:\n\n${jobs.map((j) => `- ${j.title} — ${j.company}${j.location ? ` (${j.location})` : ""}, ${j.score}% match\n  ${site}/jobs/${j.id}`).join("\n")}${footerText(c)}`;
  return { subject, html, text };
}

export function followUpEmail(c: MailContext, f: { note: string | null; jobTitle: string; company: string; dueAt: string; applicationId: string }): Mail {
  const site = c.siteUrl.replace(/\/+$/, "");
  const link = `${site}/applications?open=${f.applicationId}`;
  const subject = `Follow-up due: ${f.company}`;
  const what = f.note?.trim() || "Follow up on your application";
  const html = layout(c, subject, `<p>${esc(hello(c))}</p><p><b>${esc(what)}</b><br><span style="color:#6f6157">${esc(f.jobTitle)} · ${esc(f.company)} · due ${esc(when(f.dueAt))}</span></p><p>${button(link, "Open application")}</p>`);
  return { subject, html, text: `${hello(c)}\n\n${what}\n${f.jobTitle} · ${f.company} · due ${when(f.dueAt)}\n${link}${footerText(c)}` };
}

export function interviewEmail(c: MailContext, i: { kind: string; jobTitle: string; company: string; at: string; applicationId: string }): Mail {
  const site = c.siteUrl.replace(/\/+$/, "");
  const link = `${site}/applications?open=${i.applicationId}`;
  const label = i.kind && i.kind !== "interview" ? i.kind : "interview";
  const subject = `Upcoming ${label}: ${i.company}`;
  const html = layout(c, subject, `<p>${esc(hello(c))}</p><p>You have a ${esc(label)} coming up.</p><p><b>${esc(i.jobTitle)} · ${esc(i.company)}</b><br><span style="color:#6f6157">${esc(when(i.at))}</span></p><p>${button(link, "Prepare")}</p>`);
  return { subject, html, text: `${hello(c)}\n\nYou have a ${label} coming up.\n${i.jobTitle} · ${i.company}\n${when(i.at)}\n${link}${footerText(c)}` };
}

export function statusChangeEmail(c: MailContext, s: { jobId: string; jobTitle: string; company: string; state: "closed" | "expired" }): Mail {
  const site = c.siteUrl.replace(/\/+$/, "");
  const link = `${site}/jobs/${s.jobId}`;
  const subject = `A job you saved is no longer open: ${s.company}`;
  const why = s.state === "closed" ? "The employer's site no longer lists it." : "No source has confirmed it recently, so FRIDAY archived it.";
  const html = layout(c, subject, `<p>${esc(hello(c))}</p><p><b>${esc(s.jobTitle)} · ${esc(s.company)}</b> is no longer open. ${esc(why)}</p><p>${button(link, "View details")}</p>`);
  return { subject, html, text: `${hello(c)}\n\n${s.jobTitle} · ${s.company} is no longer open. ${why}\n${link}${footerText(c)}` };
}
