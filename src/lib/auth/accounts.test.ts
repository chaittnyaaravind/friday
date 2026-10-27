/**
 * Accounts without the Supabase mailer: sign-up never sends email, and a sign-in link only ever goes to the Telegram
 * chat of an account that already exists — generateLink would otherwise create one.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const sent: { chatId: number; text: string; url?: string }[] = [];
vi.mock("@/lib/telegram/bot", () => ({
  telegramConfigured: () => true,
  sendMessage: async (chatId: number, m: { text: string; buttons: { url?: string }[][] }) => {
    sent.push({ chatId, text: m.text, url: m.buttons[0]?.[0]?.url });
    return { messageId: 1 };
  },
}));
const { createAccount, sendTelegramLink, LINK_COOLDOWN_S } = await import("./accounts");

type Target = { user_id: string; telegram_chat_id: number; signin_link_sent_at: string | null };
function fakeAdmin(o: { createError?: { code?: string; message: string }; target?: Target }) {
  const calls = { generateLink: 0, updated: [] as unknown[] };
  const admin = {
    auth: {
      admin: {
        createUser: async () => ({ error: o.createError ?? null }),
        generateLink: async () => {
          calls.generateLink++;
          return { data: { user: { id: o.target?.user_id }, properties: { hashed_token: "h4sh" } }, error: null };
        },
      },
    },
    rpc: async () => ({ data: o.target ? [o.target] : [], error: null }),
    from: () => ({ update: (v: unknown) => ({ eq: async () => { calls.updated.push(v); return { error: null }; } }) }),
  };
  return { admin: admin as unknown as SupabaseClient, calls };
}

beforeEach(() => { sent.length = 0; });

describe("createAccount", () => {
  it("creates, or reports an existing email instead of failing", async () => {
    expect(await createAccount(fakeAdmin({}).admin, "a@sjsu.edu", "longpassword")).toBe("created");
    expect(await createAccount(fakeAdmin({ createError: { code: "email_exists", message: "x" } }).admin, "a@sjsu.edu", "longpassword")).toBe("exists");
    expect(await createAccount(fakeAdmin({ createError: { message: "A user with this email address has already been registered" } }).admin, "a@sjsu.edu", "longpassword")).toBe("exists");
    await expect(createAccount(fakeAdmin({ createError: { code: "weak_password", message: "weak" } }).admin, "a@sjsu.edu", "x")).rejects.toMatchObject({ code: "weak_password" });
  });
});

describe("sendTelegramLink", () => {
  const now = Date.parse("2026-10-27T03:00:00Z");
  const base = { email: "a@sjsu.edu", next: "/dashboard", site: "https://friday.example", now };

  it("never mints a link for an address without an account and a linked chat", async () => {
    const { admin, calls } = fakeAdmin({});
    expect(await sendTelegramLink(admin, base)).toEqual({ channel: "none" });
    expect(calls.generateLink).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("sends a one-time /auth/confirm link to the linked chat and records when", async () => {
    const { admin, calls } = fakeAdmin({ target: { user_id: "u1", telegram_chat_id: 42, signin_link_sent_at: null } });
    expect(await sendTelegramLink(admin, base)).toEqual({ channel: "telegram" });
    expect(sent[0].chatId).toBe(42);
    expect(sent[0].url).toBe("https://friday.example/auth/confirm?token_hash=h4sh&type=magiclink&next=%2Fdashboard");
    expect(calls.updated).toEqual([{ signin_link_sent_at: new Date(now).toISOString() }]);
  });

  it("waits out the cooldown instead of flooding the chat", async () => {
    const recent = new Date(now - 10_000).toISOString();
    const { admin, calls } = fakeAdmin({ target: { user_id: "u1", telegram_chat_id: 42, signin_link_sent_at: recent } });
    expect(await sendTelegramLink(admin, base)).toEqual({ channel: "wait", seconds: LINK_COOLDOWN_S - 10 });
    expect(calls.generateLink).toBe(0);
    expect(sent).toHaveLength(0);
  });
});
