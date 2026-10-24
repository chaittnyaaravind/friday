/** Linking a student's Telegram chat (one-time code) and their Gmail bridge (bearer token). Server-only; admin client. */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/api";
import { isDeskJob } from "@/lib/domain/campus-fit";
import { loadMatchProfile } from "@/lib/discovery/agent";
import { bridgeToken, linkCode, sha256 } from "./tokens";
import { enqueue } from "./pipeline";

const CODE_TTL_MS = 15 * 60_000;
/** On linking, the student also gets the desk jobs already open from the last two weeks (at most this many). */
const BACKFILL_DAYS = 14;
const BACKFILL_MAX = 10;

export async function newLinkCode(db: SupabaseClient, userId: string): Promise<string> {
  const code = linkCode();
  const { error } = await db.from("hunter_links").upsert({ user_id: userId, link_code_hash: sha256(code), link_code_expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString() }, { onConflict: "user_id" });
  if (error) throw error;
  return code;
}

/** A code sent to the bot → that chat is now the student's. Returns the user id, or null for an unknown / expired code. */
export async function redeemLinkCode(db: SupabaseClient, code: string, chatId: number): Promise<string | null> {
  const clean = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(clean)) return null;
  const { data } = await db.from("hunter_links").select("user_id, link_code_expires_at").eq("link_code_hash", sha256(clean)).maybeSingle();
  if (!data || new Date(data.link_code_expires_at as string).getTime() < Date.now()) return null;
  // One chat belongs to one FRIDAY account.
  await db.from("hunter_links").update({ telegram_chat_id: null, telegram_linked_at: null }).eq("telegram_chat_id", chatId).neq("user_id", data.user_id);
  const { error } = await db.from("hunter_links").update({ telegram_chat_id: chatId, telegram_linked_at: new Date().toISOString(), link_code_hash: null, link_code_expires_at: null, enabled: true }).eq("user_id", data.user_id);
  if (error) throw error;
  return data.user_id as string;
}

/** The campus desk jobs already open (found in the last two weeks), so linking is useful on day one. */
export async function backfill(db: SupabaseClient, userId: string): Promise<number> {
  const since = new Date(Date.now() - BACKFILL_DAYS * 86_400_000).toISOString();
  const { data } = await db.from("jobs").select("id, campus_roles, physical_demand").eq("status", "active").eq("is_on_campus", true).is("excluded_reason", null).is("imported_by", null).gte("discovered_at", since).order("discovered_at", { ascending: false }).limit(60);
  const profile = await loadMatchProfile(db, userId);
  const ids = (data ?? []).filter((j) => !profile?.campusPrefs.deskOnly || isDeskJob(j.campus_roles as string[] | null, j.physical_demand as string | null)).slice(0, BACKFILL_MAX).map((j) => j.id as string);
  return enqueue(db, ids, { userId });
}

/** A new bridge token; any earlier one stops working. Returned once, stored as a hash. */
export async function newBridgeToken(db: SupabaseClient, userId: string): Promise<string> {
  const token = bridgeToken();
  const { error } = await db.from("hunter_links").upsert({ user_id: userId, bridge_token_hash: sha256(token), bridge_created_at: new Date().toISOString(), bridge_seen_at: null }, { onConflict: "user_id" });
  if (error) throw error;
  return token;
}

/** `Authorization: Bearer fb_…` → the student it belongs to. */
export async function bridgeUser(db: SupabaseClient, req: Request): Promise<string> {
  const m = /^Bearer (fb_[A-Za-z0-9_-]{20,80})$/.exec(req.headers.get("authorization") ?? "");
  if (!m) throw new HttpError(401, "Unauthorized");
  const { data } = await db.from("hunter_links").select("user_id").eq("bridge_token_hash", sha256(m[1])).maybeSingle();
  if (!data) throw new HttpError(401, "Unauthorized");
  await db.from("hunter_links").update({ bridge_seen_at: new Date().toISOString() }).eq("user_id", data.user_id);
  return data.user_id as string;
}
