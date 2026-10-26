import { approve, loadItem, markApplied, skip } from "@/lib/hunter/actions";
import { backfill, redeemLinkCode } from "@/lib/hunter/link";
import { openJobsMessage } from "@/lib/hunter/open-jobs";
import { importPasted } from "@/lib/hunter/paste-import";
import { parsePastedJob } from "@/lib/hunter/pasted-job";
import { processQueue } from "@/lib/hunter/pipeline";
import { sameSecret } from "@/lib/hunter/tokens";
import { answerCallback, sendMessage } from "@/lib/telegram/bot";
import { createSupabaseAdmin } from "@/lib/supabase/server";

export const maxDuration = 300;

type Update = {
  message?: { chat: { id: number; type: string }; text?: string };
  callback_query?: { id: string; from: { id: number }; data?: string; message?: { chat: { id: number } } };
};

const HELP = "FRIDAY sends you new SJSU desk jobs here, ready to approve. Send /open to see every SJSU job open to apply right now. Saw a job on Handshake? Copy the whole job page (its link too, if you like) and paste it here: FRIDAY tailors your resume to it. To link this chat, open FRIDAY → Settings → Auto Hunter and tap “Connect Telegram”.";
const LINK_ONLY = "Handshake needs your login, so FRIDAY can't open that link. Open the job in Handshake, select all of its text, copy it, and paste it here (with the link if you like).";
const NO_TITLE = "FRIDAY couldn't find the job title in that. Paste it again with “Title: …” and “Employer: …” as the first two lines.";

/**
 * POST /api/telegram/webhook — updates from the FRIDAY bot. Only Telegram knows TELEGRAM_WEBHOOK_SECRET (set with
 * setWebhook), so anything without it is refused. Buttons act only for the student whose linked chat pressed them.
 */
export async function POST(req: Request) {
  if (!sameSecret(req.headers.get("x-telegram-bot-api-secret-token"), process.env.TELEGRAM_WEBHOOK_SECRET)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const update = (await req.json()) as Update;
    const db = createSupabaseAdmin();

    if (update.message?.text && update.message.chat.type === "private") {
      const chatId = update.message.chat.id;
      // /open: what is open to apply right now. Only for a linked chat (the bot serves FRIDAY students, not strangers).
      if (/^\/(?:open|jobs|count)(?:@\w+)?\s*$/i.test(update.message.text.trim())) {
        const { data: linked } = await db.from("hunter_links").select("user_id").eq("telegram_chat_id", chatId).maybeSingle();
        await sendMessage(chatId, linked ? await openJobsMessage(db, (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "")) : { text: HELP, buttons: [] });
        return Response.json({ ok: true });
      }
      // A pasted job (from Handshake or anywhere): imported for this student, then the usual tailored card follows.
      const paste = parsePastedJob(update.message.text);
      if (paste) {
        const { data: linked } = await db.from("hunter_links").select("user_id").eq("telegram_chat_id", chatId).maybeSingle();
        if (!linked) await sendMessage(chatId, { text: HELP, buttons: [] });
        else if ("error" in paste) await sendMessage(chatId, { text: paste.error === "link_only" ? LINK_ONLY : NO_TITLE, buttons: [] });
        else {
          const { reply, queued } = await importPasted(db, linked.user_id as string, paste.job);
          await sendMessage(chatId, reply);
          if (queued) await processQueue(db, { deadline: Date.now() + 90_000, userId: linked.user_id as string, limit: 3 });
        }
        return Response.json({ ok: true });
      }
      const code = /^\/start\s+([A-Za-z0-9]{8})\s*$/.exec(update.message.text.trim())?.[1] ?? (/^[A-Za-z0-9]{8}$/.test(update.message.text.trim()) ? update.message.text.trim() : null);
      if (!code) {
        await sendMessage(chatId, { text: HELP, buttons: [] });
        return Response.json({ ok: true });
      }
      const userId = await redeemLinkCode(db, code, chatId);
      if (!userId) {
        await sendMessage(chatId, { text: "That code is wrong or expired. Get a new one in FRIDAY → Settings → Telegram.", buttons: [] });
        return Response.json({ ok: true });
      }
      const queued = await backfill(db, userId);
      await sendMessage(chatId, { text: `✅ Linked. FRIDAY checks SJSU every minute and sends new desk jobs here, ready to approve.${queued ? `\nPreparing ${queued} open desk job${queued === 1 ? "" : "s"} for you now…` : ""}`, buttons: [] });
      if (queued) await processQueue(db, { deadline: Date.now() + 90_000, userId });
      return Response.json({ ok: true });
    }

    const cb = update.callback_query;
    if (cb?.data && cb.message) {
      const m = /^(ap|sk|dn):([0-9a-f-]{36})$/.exec(cb.data);
      const item = m ? await loadItem(db, m[2]) : null;
      const { data: link } = item ? await db.from("hunter_links").select("telegram_chat_id").eq("user_id", item.user_id).maybeSingle() : { data: null };
      const chatId = cb.message.chat.id;
      if (!m || !item || link?.telegram_chat_id !== chatId || cb.from.id !== chatId) {
        await answerCallback(cb.id, "This button isn't for this chat.");
        return Response.json({ ok: true });
      }
      const toast = m[1] === "ap" ? await approve(db, item, chatId) : m[1] === "sk" ? await skip(db, item, chatId) : await markApplied(db, item, chatId);
      await answerCallback(cb.id, toast);
      // A card that changed is re-prepared right away rather than at the next watch tick.
      if (m[1] === "ap") await processQueue(db, { deadline: Date.now() + 60_000, userId: item.user_id, limit: 1 });
    }
    return Response.json({ ok: true });
  } catch (e) {
    // Telegram re-delivers any update that is not answered 200, so a failure is logged and acknowledged, never retried blindly.
    console.error("telegram webhook:", e instanceof Error ? e.message : e);
    return Response.json({ ok: false });
  }
}
