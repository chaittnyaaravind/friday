/**
 * Telegram Bot API, the few calls FRIDAY uses. Needs TELEGRAM_BOT_TOKEN; without it every call is a no-op that
 * reports `configured: false` — nothing is faked. The token is never logged or returned.
 */
import "server-only";
import type { Button, TgMessage } from "@/lib/hunter/message";

const API = "https://api.telegram.org";
export const telegramConfigured = () => Boolean(process.env.TELEGRAM_BOT_TOKEN);
export const botUsername = () => process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "") || null;

export class TelegramError extends Error {
  constructor(message: string, readonly code: number) {
    super(message);
  }
}

const keyboard = (rows: Button[][]) =>
  rows.length ? { inline_keyboard: rows.map((r) => r.map((b) => (b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data }))) } : undefined;

async function call<T>(method: string, payload: Record<string, unknown> | FormData): Promise<T> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new TelegramError("Telegram is not configured", 0);
  const isForm = payload instanceof FormData;
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: "POST",
    headers: isForm ? undefined : { "content-type": "application/json" },
    body: isForm ? payload : JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string; error_code?: number };
  if (!json.ok) throw new TelegramError(`Telegram ${method}: ${(json.description ?? res.statusText).slice(0, 200)}`, json.error_code ?? res.status);
  return json.result as T;
}

export async function sendMessage(chatId: number, m: TgMessage): Promise<{ messageId: number }> {
  const r = await call<{ message_id: number }>("sendMessage", { chat_id: chatId, text: m.text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: keyboard(m.buttons) });
  return { messageId: r.message_id };
}

/** Replace a card's text and buttons (e.g. after Approve, so it cannot be tapped twice). A message that no longer changes is fine. */
export async function editMessage(chatId: number, messageId: number, m: TgMessage): Promise<void> {
  try {
    await call("editMessageText", { chat_id: chatId, message_id: messageId, text: m.text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: keyboard(m.buttons) ?? { inline_keyboard: [] } });
  } catch (e) {
    if (!(e instanceof TelegramError && /not modified/i.test(e.message))) throw e;
  }
}

export async function answerCallback(callbackId: string, text?: string): Promise<void> {
  await call("answerCallbackQuery", { callback_query_id: callbackId, ...(text ? { text: text.slice(0, 190) } : {}) }).catch(() => undefined);
}

export async function sendDocument(chatId: number, file: { name: string; bytes: Uint8Array; type: string }, caption?: string): Promise<void> {
  const form = new FormData();
  form.set("chat_id", String(chatId));
  form.set("document", new Blob([file.bytes as BlobPart], { type: file.type }), file.name);
  if (caption) form.set("caption", caption.slice(0, 1000));
  await call("sendDocument", form);
}

/** Point the bot at FRIDAY. Telegram then sends every update with our secret in X-Telegram-Bot-Api-Secret-Token. */
export async function setWebhook(url: string, secret: string): Promise<void> {
  await call("setWebhook", { url, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
}
