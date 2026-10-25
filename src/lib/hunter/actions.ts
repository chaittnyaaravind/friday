/**
 * What happens after the student taps a button in Telegram, and when their Gmail bridge reports a send.
 *
 *   approve  re-reads the packet; if it is still exactly what the card showed, records the approval (packet_approvals,
 *            bound to the content hash, with the confirmations the card displayed) and then EITHER queues the email for
 *            the student's own Gmail bridge OR sends them the resume PDF and the official link to submit themselves.
 *            If anything changed since the card was sent, nothing is approved and a fresh card is prepared.
 *   skip     the student does not want it. Nothing else changes.
 *   applied  the student says they submitted on the official page → "applied" in the tracker, with its follow-up.
 *   sent     the bridge sent the approved email from the student's Gmail → "applied", with the Gmail message id as evidence.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/api";
import { approvePacket, getPacketState, handOff } from "@/lib/apply/packet-service";
import { moveStatus } from "@/lib/apply/track";
import { renderPdf } from "@/lib/resume/export";
import type { ResumeDoc } from "@/lib/resume/types";
import { editMessage, sendDocument, sendMessage } from "@/lib/telegram/bot";
import { esc, handOffNotice, sentNotice, type TgMessage } from "./message";

export type HuntItem = {
  id: string; user_id: string; job_id: string; application_id: string | null; packet_id: string | null; content_hash: string | null;
  confirmations: string[]; channel: "email" | "site" | null; email_to: string | null; email_subject: string | null; email_body: string | null;
  state: string; telegram_message_id: number | null;
};

export async function loadItem(db: SupabaseClient, id: string): Promise<HuntItem | null> {
  const { data } = await db.from("hunt_items").select("*").eq("id", id).maybeSingle();
  return (data as HuntItem | null) ?? null;
}

const touch = (db: SupabaseClient, id: string, patch: Record<string, unknown>) => db.from("hunt_items").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
const note = (text: string): TgMessage => ({ text, buttons: [] });

async function jobTitle(db: SupabaseClient, item: HuntItem) {
  const { data } = await db.from("applications").select("job_title, company_name").eq("id", item.application_id ?? "").eq("user_id", item.user_id).maybeSingle();
  return { title: (data?.job_title as string | undefined) ?? "this job", employer: (data?.company_name as string | undefined) ?? "" };
}

export async function resumePdf(db: SupabaseClient, userId: string, versionId: string): Promise<{ name: string; bytes: Uint8Array } | null> {
  const [{ data: v }, { data: p }] = await Promise.all([
    db.from("resume_versions").select("content").eq("id", versionId).eq("user_id", userId).maybeSingle(),
    db.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
  ]);
  if (!v) return null;
  const name = `${((p?.full_name as string | null) ?? "Resume").replace(/[^\p{L}\p{N} .-]/gu, "").trim() || "Resume"} - Resume.pdf`;
  return { name, bytes: await renderPdf(v.content as ResumeDoc) };
}

/** Returns the short text shown in the Telegram toast. */
export async function approve(db: SupabaseClient, item: HuntItem, chatId: number): Promise<string> {
  if (item.state !== "notified") return item.state === "skipped" ? "You skipped this one." : "Already handled.";
  if (!item.application_id || !item.packet_id || !item.content_hash) return "This card is incomplete; open it in FRIDAY.";
  // Claim the card atomically: a double tap (or Telegram re-delivering the update) approves at most once.
  const { data: claimed } = await db.from("hunt_items").update({ state: "approved", updated_at: new Date().toISOString() }).eq("id", item.id).eq("state", "notified").select("id");
  if (!claimed?.length) return "Already handled.";
  try {
    return await approveClaimed(db, item as Parameters<typeof approveClaimed>[1], chatId);
  } catch (e) {
    await touch(db, item.id, { state: "notified" }); // nothing was sent: let the student try again
    if (e instanceof HttpError) return e.message.slice(0, 180);
    throw e;
  }
}

async function approveClaimed(db: SupabaseClient, item: HuntItem & { application_id: string; packet_id: string; content_hash: string }, chatId: number): Promise<string> {
  const state = await getPacketState(db, item.user_id, item.application_id);
  if (!state || state.packetId !== item.packet_id || state.contentHash !== item.content_hash) {
    // The listing or the packet changed after the card was sent: approving now would approve something unseen.
    await touch(db, item.id, { state: "queued", attempts: 0 });
    if (item.telegram_message_id) await editMessage(chatId, item.telegram_message_id, note("♻️ This application changed after this card was sent, so it was not approved. A fresh card is on its way."));
    return "Changed since this card — not approved.";
  }
  await approvePacket(db, item.user_id, item.application_id, { packetId: item.packet_id, contentHash: item.content_hash, acknowledged: item.confirmations });
  await moveStatus(db, item.user_id, item.application_id, "ready", { note: "Approved in Telegram" });
  const { title, employer } = await jobTitle(db, item);
  const versionId = state.packet.resume?.versionId ?? null;

  if (item.channel === "email" && item.email_to && item.email_subject && item.email_body) {
    const { error } = await db.from("outbox").insert({
      user_id: item.user_id, hunt_item_id: item.id, application_id: item.application_id, to_email: item.email_to,
      subject: item.email_subject, body: item.email_body, resume_version_id: versionId,
    });
    if (error && error.code !== "23505") throw error;
    await touch(db, item.id, { state: "sending" });
    if (item.telegram_message_id) await editMessage(chatId, item.telegram_message_id, note(`✅ <b>Approved</b> — ${esc(title)} (${esc(employer)})\nYour Gmail bridge sends it to ${esc(item.email_to)} within about 5 minutes. You'll get a message when it's sent.`));
    return "Approved — sending from your Gmail.";
  }

  const { url } = await handOff(db, item.user_id, item.application_id);
  const pdf = versionId ? await resumePdf(db, item.user_id, versionId) : null;
  // The resume is the point of the hand-off: its caption says what it is and where it goes, and a missing one is said.
  if (pdf) await sendDocument(chatId, { name: pdf.name, bytes: pdf.bytes, type: "application/pdf" }, `📄 Your tailored resume for ${title}${employer ? ` (${employer})` : ""}.\nAttach this file to the application form: ${url}`);
  if (item.telegram_message_id) await editMessage(chatId, item.telegram_message_id, note(`✅ <b>Approved</b> — ${esc(title)} (${esc(employer)})`));
  await sendMessage(chatId, handOffNotice({ itemId: item.id, title, url, reason: pdf ? null : "⚠️ FRIDAY couldn't attach your resume here; download it in FRIDAY → Applications before you submit." }));
  await touch(db, item.id, { state: "handed_off" });
  return "Approved — resume and link sent.";
}

export async function skip(db: SupabaseClient, item: HuntItem, chatId: number): Promise<string> {
  if (item.state !== "notified") return "Already handled.";
  await touch(db, item.id, { state: "skipped" });
  const { title } = await jobTitle(db, item);
  if (item.telegram_message_id) await editMessage(chatId, item.telegram_message_id, note(`⏭ Skipped — ${esc(title)}. It stays in FRIDAY if you change your mind.`));
  return "Skipped.";
}

export async function markApplied(db: SupabaseClient, item: HuntItem, chatId: number): Promise<string> {
  if (item.state !== "handed_off" || !item.application_id) return item.state === "applied" ? "Already marked applied." : "Approve it first.";
  await moveStatus(db, item.user_id, item.application_id, "applied", { note: "Submitted on the official page (confirmed by the student in Telegram)" });
  await touch(db, item.id, { state: "applied" });
  const { title } = await jobTitle(db, item);
  await sendMessage(chatId, note(`📨 Marked <b>applied</b> — ${esc(title)}. FRIDAY will remind you to follow up in a week.`));
  return "Marked applied.";
}

/** The bridge reports one outbox item. Only the owner's pending/claimed rows can be completed. */
export async function recordSent(db: SupabaseClient, userId: string, outboxId: string, result: { messageId: string } | { error: string }) {
  const { data: row } = await db.from("outbox").select("id, hunt_item_id, application_id, to_email, state").eq("id", outboxId).eq("user_id", userId).maybeSingle();
  if (!row) throw new HttpError(404, "Not found");
  if (row.state === "sent") return { state: "sent" };
  const { data: link } = await db.from("hunter_links").select("telegram_chat_id").eq("user_id", userId).maybeSingle();
  const chat = (link?.telegram_chat_id as number | null) ?? null;
  const item = await loadItem(db, row.hunt_item_id as string);

  if ("error" in result) {
    await db.from("outbox").update({ state: "failed", error: result.error.slice(0, 500) }).eq("id", outboxId);
    if (item) await touch(db, item.id, { state: "failed", error: `Gmail could not send: ${result.error.slice(0, 300)}` });
    if (chat) await sendMessage(chat, note(`⚠️ Your Gmail could not send the application to ${esc(row.to_email as string)}: ${esc(result.error.slice(0, 300))}\nNothing was marked applied. Open FRIDAY to send it yourself.`));
    return { state: "failed" };
  }

  const at = new Date();
  await db.from("outbox").update({ state: "sent", sent_at: at.toISOString(), gmail_message_id: result.messageId.slice(0, 200), error: null }).eq("id", outboxId);
  await moveStatus(db, userId, row.application_id as string, "applied", { evidence: `Sent from your Gmail to ${row.to_email} on ${at.toISOString()} (Gmail message ${result.messageId.slice(0, 120)})`, note: "Sent by the Gmail bridge after approval" });
  if (item) await touch(db, item.id, { state: "sent" });
  if (chat && item) {
    const { title, employer } = await jobTitle(db, item);
    await sendMessage(chat, sentNotice({ title, employer, to: row.to_email as string, at: at.toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" }) }));
  }
  return { state: "sent" };
}
