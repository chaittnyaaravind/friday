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
const { createAccount, isBreachedPassword, readTurn, sendTelegramLink, signTurn, LINK_COOLDOWN_S } = await import("./accounts");

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

describe("createAccount under load", () => {
  const flaky = (errors: ({ code?: string; status?: number; message: string } | null)[]) => {
    let i = 0;
    return { auth: { admin: { createUser: async () => ({ error: errors[Math.min(i++, errors.length - 1)] }) } } } as unknown as SupabaseClient;
  };
  const timeout = { code: "request_timeout", status: 504, message: "context deadline exceeded" };
  const exists = { code: "email_exists", message: "already registered" };
  const noWait = { wait: async () => {} };

  it("retries a timed-out auth server until the account is created", async () => {
    expect(await createAccount(flaky([timeout, timeout, null]), "a@sjsu.edu", "longpassword", noWait)).toBe("created");
  });

  it("claims an account its own timed-out attempt created, and only that", async () => {
    expect(await createAccount(flaky([timeout, exists]), "a@sjsu.edu", "longpassword", { ...noWait, isOurs: async () => true })).toBe("created");
    expect(await createAccount(flaky([timeout, exists]), "a@sjsu.edu", "longpassword", { ...noWait, isOurs: async () => false })).toBe("exists");
    expect(await createAccount(flaky([exists]), "a@sjsu.edu", "longpassword", { ...noWait, isOurs: async () => true })).toBe("exists");
  });

  it("gives up after a bounded number of tries", async () => {
    await expect(createAccount(flaky([timeout]), "a@sjsu.edu", "longpassword", noWait)).rejects.toMatchObject({ code: "request_timeout" });
  });
});

describe("sign-up turns", () => {
  const at = Date.parse("2026-10-27T04:00:00Z");
  it("round-trip for the same email and key", () => {
    expect(readTurn(signTurn("a@sjsu.edu", at, "k1"), "a@sjsu.edu", "k1")).toBe(at);
  });
  it("cannot be moved up the line, reused for another email, or forged", () => {
    const t = signTurn("a@sjsu.edu", at, "k1");
    expect(readTurn(t.replace(String(at), String(at - 60_000)), "a@sjsu.edu", "k1")).toBeNull();
    expect(readTurn(t, "b@sjsu.edu", "k1")).toBeNull();
    expect(readTurn(t, "a@sjsu.edu", "k2")).toBeNull();
    expect(readTurn("garbage", "a@sjsu.edu", "k1")).toBeNull();
    expect(readTurn(undefined, "a@sjsu.edu", "k1")).toBeNull();
  });
});

describe("isBreachedPassword", () => {
  // SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
  const range = (body: string, ok = true) => (async (url: string) => {
    expect(url).toBe("https://api.pwnedpasswords.com/range/5BAA6");
    return new Response(body, { status: ok ? 200 : 503 });
  }) as unknown as typeof fetch;

  it("matches the suffix and only ever sends the 5-character prefix", async () => {
    expect(await isBreachedPassword("password", { fetch: range("1E4C9B93F3F0682250B6CF8331B7EE68FD8:9545824\r\nFFFFF:0") })).toBe(true);
    expect(await isBreachedPassword("password", { fetch: range("0000000000000000000000000000000000A:3") })).toBe(false);
  });
  it("ignores padding rows and never blocks sign-up when the service is down", async () => {
    expect(await isBreachedPassword("password", { fetch: range("1E4C9B93F3F0682250B6CF8331B7EE68FD8:0") })).toBe(false);
    expect(await isBreachedPassword("password", { fetch: range("", false) })).toBe(false);
    expect(await isBreachedPassword("password", { fetch: (async () => { throw new Error("offline"); }) as unknown as typeof fetch })).toBe(false);
  });
});
