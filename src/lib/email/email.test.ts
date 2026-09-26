import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFS, normalizePrefs } from "@/lib/domain/notify-prefs";
import { followUpEmail, interviewEmail, newMatchesEmail, statusChangeEmail, type MailContext } from "./templates";
import { unsubscribeToken, unsubscribeUrl, verifyUnsubscribeToken } from "./token";

vi.mock("server-only", () => ({}));
const { emailConfigured, emailStatus, MAX_EMAILS_PER_DAY, sendMail } = await import("./send");

// ── a tiny in-memory stand-in for the two email_log queries and the insert sendMail makes ──
type Row = { user_id: string; dedupe_key: string; status: string; created_at: string; [k: string]: unknown };
function fakeDb(rows: Row[] = [], now = Date.now()) {
  return {
    rows,
    from() {
      const f: Record<string, unknown> = {};
      let since: string | null = null;
      let head = false;
      const match = () => rows.filter((r) => Object.entries(f).every(([k, v]) => r[k] === v) && (!since || r.created_at >= since));
      const q: Record<string, unknown> = {
        select: (_c: string, o?: { head?: boolean }) => ((head = Boolean(o?.head)), q),
        eq: (k: string, v: unknown) => ((f[k] = v), q),
        gte: (_k: string, v: string) => ((since = v), q),
        maybeSingle: async () => ({ data: match()[0] ?? null }),
        insert: async (row: Record<string, unknown>) => {
          rows.push({ created_at: new Date(now).toISOString(), ...row } as Row);
          return { error: null };
        },
        then: (resolve: (v: unknown) => unknown) => resolve({ count: match().length, data: head ? null : match() }),
      };
      return q;
    },
  };
}
const ENV = { RESEND_API_KEY: "re_test_SECRET_key_123", EMAIL_FROM: "FRIDAY <alerts@example.com>" };
const mail = { subject: "s", html: "<p>h</p>", text: "t" };
const msg = (over: Partial<Parameters<typeof sendMail>[1]> = {}) => ({ userId: "u1", to: "student@example.com", kind: "follow_up" as const, dedupeKey: "follow_up:1", mail, unsubscribeUrl: "https://x/unsub", ...over });
const okFetch = () => vi.fn(async () => new Response(JSON.stringify({ id: "msg_1" }), { status: 200 })) as unknown as typeof fetch;

describe("email configuration", () => {
  it("is configured only when both the API key and sender exist, and says what is missing", () => {
    expect(emailConfigured({})).toBe(false);
    expect(emailStatus({ RESEND_API_KEY: "k" })).toEqual({ configured: false, missing: ["EMAIL_FROM"] });
    expect(emailStatus(ENV)).toEqual({ configured: true, missing: [] });
  });
});

describe("sendMail", () => {
  it("does not send — or pretend to — when Resend is not configured", async () => {
    const db = fakeDb();
    const fetcher = okFetch();
    const r = await sendMail(db as never, msg(), { env: {}, fetch: fetcher });
    expect(r).toEqual({ status: "skipped", reason: "not_configured" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(db.rows).toHaveLength(0);
  });

  it("sends through Resend with the key only in the Authorization header, and logs it", async () => {
    const db = fakeDb();
    const fetcher = okFetch();
    const r = await sendMail(db as never, msg(), { env: ENV, fetch: fetcher });
    expect(r.status).toBe("sent");
    const [url, init] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${ENV.RESEND_API_KEY}`);
    expect(String(init.body)).not.toContain(ENV.RESEND_API_KEY);
    expect(JSON.parse(String(init.body)).headers["List-Unsubscribe"]).toBe("<https://x/unsub>");
    expect(db.rows[0]).toMatchObject({ user_id: "u1", status: "sent", provider_id: "msg_1", dedupe_key: "follow_up:1" });
  });

  it("never sends the same message twice", async () => {
    const db = fakeDb();
    const fetcher = okFetch();
    expect((await sendMail(db as never, msg(), { env: ENV, fetch: fetcher })).status).toBe("sent");
    expect(await sendMail(db as never, msg(), { env: ENV, fetch: fetcher })).toEqual({ status: "skipped", reason: "duplicate" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rate-limits to MAX_EMAILS_PER_DAY per user, counting only the last 24 hours", async () => {
    const now = Date.now();
    const recent = Array.from({ length: MAX_EMAILS_PER_DAY }, (_, i) => ({ user_id: "u1", dedupe_key: `k${i}`, status: "sent", created_at: new Date(now - 3_600_000).toISOString() }));
    const limited = await sendMail(fakeDb(recent, now) as never, msg(), { env: ENV, fetch: okFetch(), now });
    expect(limited).toEqual({ status: "skipped", reason: "rate_limited" });
    const old = recent.map((r) => ({ ...r, created_at: new Date(now - 30 * 3_600_000).toISOString() }));
    expect((await sendMail(fakeDb(old, now) as never, msg(), { env: ENV, fetch: okFetch(), now })).status).toBe("sent");
    const other = recent.map((r) => ({ ...r, user_id: "someone-else" }));
    expect((await sendMail(fakeDb(other, now) as never, msg(), { env: ENV, fetch: okFetch(), now })).status).toBe("sent");
  });

  it("logs a failure with a short reason that never contains the API key, and allows a retry", async () => {
    const db = fakeDb();
    const failing = vi.fn(async () => new Response(JSON.stringify({ message: `invalid key ${ENV.RESEND_API_KEY}` }), { status: 401 })) as unknown as typeof fetch;
    const r = await sendMail(db as never, msg(), { env: ENV, fetch: failing });
    expect(r.status).toBe("failed");
    expect(r.reason).toMatch(/^resend 401/);
    expect(JSON.stringify(db.rows)).not.toContain(ENV.RESEND_API_KEY);
    expect(db.rows[0]).toMatchObject({ status: "failed" });
    // a failed attempt is not a "sent" duplicate: the next run may try again
    expect((await sendMail(db as never, msg(), { env: ENV, fetch: okFetch() })).status).toBe("sent");
  });

  it("treats a network error as a logged failure, not a crash", async () => {
    const db = fakeDb();
    const boom = vi.fn(async () => { throw new Error(`connect failed for ${ENV.RESEND_API_KEY}`); }) as unknown as typeof fetch;
    const r = await sendMail(db as never, msg(), { env: ENV, fetch: boom });
    expect(r.status).toBe("failed");
    expect(r.reason).not.toContain(ENV.RESEND_API_KEY);
    expect(db.rows[0]).toMatchObject({ status: "failed" });
  });
});

describe("templates", () => {
  const ctx: MailContext = { siteUrl: "https://friday.example/", unsubscribeUrl: "https://friday.example/api/email/unsubscribe?u=1&t=abc", name: "Jordan Lee" };

  it("new-matches: counts, links to each job, greets by first name", () => {
    const m = newMatchesEmail(ctx, [{ id: "j1", title: "SWE Intern", company: "Acme", location: "San Jose, CA", score: 82 }, { id: "j2", title: "Data Intern", company: "Beta", location: null, score: 74 }]);
    expect(m.subject).toBe("2 new opportunities match your profile");
    expect(m.text).toContain("Hi Jordan,");
    expect(m.html).toContain("https://friday.example/jobs/j1");
    expect(m.text).toContain("82% match");
  });
  it("escapes HTML in everything dynamic", () => {
    const m = newMatchesEmail(ctx, [{ id: "j1", title: '<script>alert("x")</script>', company: "A&B", location: null, score: 80 }]);
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).toContain("A&amp;B");
  });
  it("every template carries the unsubscribe link and a preferences link", () => {
    const all = [
      newMatchesEmail(ctx, [{ id: "j", title: "t", company: "c", location: null, score: 70 }]),
      followUpEmail(ctx, { note: null, jobTitle: "t", company: "c", dueAt: "2026-10-01T18:00:00Z", applicationId: "a1" }),
      interviewEmail(ctx, { kind: "technical", jobTitle: "t", company: "c", at: "2026-10-02T18:00:00Z", applicationId: "a1" }),
      statusChangeEmail(ctx, { jobId: "j", jobTitle: "t", company: "c", state: "closed" }),
    ];
    for (const m of all) {
      expect(m.html).toContain(ctx.unsubscribeUrl.replace(/&/g, "&amp;")); // attribute values are HTML-escaped; mail clients decode them
      expect(m.text).toContain(ctx.unsubscribeUrl);
      expect(m.html).toContain("https://friday.example/settings");
    }
  });
  it("states only what is known: closed vs expired wording, no invented application status", () => {
    expect(statusChangeEmail(ctx, { jobId: "j", jobTitle: "t", company: "c", state: "closed" }).text).toContain("no longer lists it");
    expect(statusChangeEmail(ctx, { jobId: "j", jobTitle: "t", company: "c", state: "expired" }).text).toContain("archived it");
    expect(interviewEmail(ctx, { kind: "interview", jobTitle: "t", company: "Acme", at: "2026-10-02T18:00:00Z", applicationId: "a" }).subject).toBe("Upcoming interview: Acme");
  });
});

describe("unsubscribe tokens", () => {
  const env = { AI_SIGNING_SECRET: "test-secret-0123456789" };
  it("verify only for the user they were issued to", () => {
    const t = unsubscribeToken("user-1", env);
    expect(verifyUnsubscribeToken("user-1", t, env)).toBe(true);
    expect(verifyUnsubscribeToken("user-2", t, env)).toBe(false);
  });
  it("reject tampered, malformed and unsigned tokens", () => {
    const t = unsubscribeToken("user-1", env);
    expect(verifyUnsubscribeToken("user-1", t.slice(0, -1) + (t.endsWith("0") ? "1" : "0"), env)).toBe(false);
    expect(verifyUnsubscribeToken("user-1", "nothex", env)).toBe(false);
    expect(verifyUnsubscribeToken("user-1", t, {})).toBe(false);
    expect(() => unsubscribeToken("user-1", {})).toThrow();
  });
  it("builds an absolute link on the public site", () => {
    expect(unsubscribeUrl("https://friday.example/", "user-1", env)).toMatch(/^https:\/\/friday\.example\/api\/email\/unsubscribe\?u=user-1&t=[0-9a-f]{40}$/);
  });
});

describe("notification preferences", () => {
  it("falls back to quiet defaults for missing or malformed data", () => {
    expect(normalizePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(normalizePrefs("garbage")).toEqual(DEFAULT_PREFS);
    expect(normalizePrefs({ email: { new_matches: "yes" }, min_match_score: "high" })).toEqual(DEFAULT_PREFS);
  });
  it("keeps valid choices, fills the rest, and clamps the score threshold", () => {
    const p = normalizePrefs({ email: { follow_ups: false }, in_app: { source_updates: true }, min_match_score: 200 });
    expect(p.email).toMatchObject({ follow_ups: false, new_matches: true });
    expect(p.in_app.source_updates).toBe(true);
    expect(p.min_match_score).toBe(95);
    expect(normalizePrefs({ min_match_score: 5 }).min_match_score).toBe(40);
  });
  it("by default source updates are off — quiet unless the student opts in", () => {
    expect(DEFAULT_PREFS.in_app.source_updates).toBe(false);
  });
});
