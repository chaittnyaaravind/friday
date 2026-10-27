"use client";

import { ArrowLeft, Eye, EyeOff, Loader2, Mail, Send } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { EASE_OUT } from "@/components/motion";
import { Button, Field, Input, Label, cx } from "@/components/ui";
import { safeNextPath } from "@/lib/auth/safe-next";
import { createSupabaseBrowser } from "@/lib/supabase/client";

type Mode = "signin" | "signup" | "magic";
type Sent = { kind: "magic" | "confirm" | "telegram"; email: string; bot?: string | null };

const RESEND_AFTER = 30;

/** Supabase's messages, said the way a student would want to hear them. */
function friendly(raw: string): string {
  if (/invalid login credentials/i.test(raw)) return "That email and password don't match. Try again, or get a sign-in link by email.";
  if (/email not confirmed/i.test(raw)) return "Confirm your email first: open the link FRIDAY sent you, or get a fresh sign-in link below.";
  if (/rate limit|too many|security purposes/i.test(raw)) return "Too many tries in a row. Wait a minute, then try again.";
  if (/already registered|already exists/i.test(raw)) return "You already have an account with this email. Sign in instead.";
  return raw;
}

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}

function Login() {
  const router = useRouter();
  const sp = useSearchParams();
  const reduced = useReducedMotion();
  const next = safeNextPath(sp.get("next"));
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(sp.get("error"));
  const [sent, setSent] = useState<Sent | null>(null);
  const [wait, setWait] = useState(0);
  const submitting = useRef(false);
  const trap = useRef<HTMLInputElement>(null);
  const [queued, setQueued] = useState(false);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const switchTo = (m: Mode) => {
    setMode(m);
    setError(null);
  };

  const redirectUrl = () => {
    // Email links point at the configured public site (the Vercel app); fall back to wherever this page is served from.
    const site = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") || window.location.origin;
    return `${site}/auth/callback?next=${encodeURIComponent(next)}`;
  };

  // Telegram first: FRIDAY mints the link itself, so no email limit applies (api/auth/link). Email only as the fallback.
  const sendLink = async (to: string) => {
    const r = (await fetch("/api/auth/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: to, next }) })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)) as { channel: "telegram" | "none" | "wait"; seconds?: number; bot?: string | null } | null;
    if (r && r.channel !== "none") {
      setSent({ kind: "telegram", email: to, bot: r.bot });
      setWait(r.channel === "wait" ? r.seconds ?? RESEND_AFTER : RESEND_AFTER);
      return;
    }
    const { error } = await createSupabaseBrowser().auth.signInWithOtp({ email: to, options: { emailRedirectTo: redirectUrl(), shouldCreateUser: false } });
    if (error) throw error;
    setSent({ kind: "magic", email: to });
    setWait(RESEND_AFTER);
  };

  // The old path, kept only for a server without the admin key (api/auth/signup answers 503 there).
  const emailSignUp = async (to: string) => {
    const { data, error } = await createSupabaseBrowser().auth.signUp({ email: to, password, options: { emailRedirectTo: redirectUrl() } });
    if (error) throw error;
    // Supabase answers a sign-up for an existing email with a user that has no identities, instead of an error.
    if (data.user && data.user.identities?.length === 0) {
      setMode("signin");
      throw new Error("You already have an account with this email. Sign in instead.");
    }
    if (data.session) {
      router.replace("/onboarding");
      router.refresh();
    } else {
      setSent({ kind: "confirm", email: to });
      setWait(RESEND_AFTER);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    const supabase = createSupabaseBrowser();
    const to = email.trim();
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email: to, password });
        if (error) throw error;
        router.replace(next);
        router.refresh();
      } else if (mode === "signup") {
        // The account is created on FRIDAY's server, already confirmed: no verification email to wait for.
        // 202 = in line behind other sign-ups (api/auth/signup admission control); a failed request is retried too.
        // Asking again is safe: an account this request already created is recognised by its password.
        let res: Response | null = null;
        const until = Date.now() + 5 * 60_000;
        for (let attempt = 0; Date.now() < until; attempt++) {
          // Back off as the line grows (1.5s → 10s, jittered), so a long line costs the server less, not more.
          if (attempt) await new Promise((r) => setTimeout(r, Math.min(10_000, 1500 * 1.5 ** (attempt - 1)) * (0.6 + Math.random() * 0.8)));
          res = await fetch("/api/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: to, password, website: trap.current?.value || undefined }) }).catch(() => null);
          if (res && res.status !== 202 && (res.status < 500 || res.status === 503)) break;
          setQueued(true);
        }
        setQueued(false);
        if (res?.status === 202) throw new Error("FRIDAY is very busy right now. Your place wasn't lost: press Create account again.");
        if (!res) throw new Error("Couldn't reach FRIDAY. Check your connection and try again.");
        if (res.status === 409) {
          // Already a member: if this is their password, just let them in instead of making them switch tabs.
          const { error } = await supabase.auth.signInWithPassword({ email: to, password });
          if (!error) {
            router.replace(next);
            router.refresh();
            return;
          }
          setMode("signin");
          throw new Error("You already have an account with this email. Sign in with your password, or get a sign-in link.");
        }
        if (res.status === 503) await emailSignUp(to);
        else if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't create the account. Try again.");
        else {
          const { error } = await supabase.auth.signInWithPassword({ email: to, password });
          if (error) throw error;
          router.replace("/onboarding");
          router.refresh();
        }
      } else {
        await sendLink(to);
      }
    } catch (err) {
      setError(friendly((err as Error).message));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!sent || wait > 0) return;
    setError(null);
    try {
      if (sent.kind === "confirm") {
        const { error } = await createSupabaseBrowser().auth.resend({ type: "signup", email: sent.email, options: { emailRedirectTo: redirectUrl() } });
        if (error) throw error;
        setWait(RESEND_AFTER);
      } else await sendLink(sent.email);
    } catch (err) {
      setError(friendly((err as Error).message));
    }
  };

  const swap = reduced ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } : {
    initial: { opacity: 0, y: 14, filter: "blur(6px)" },
    animate: { opacity: 1, y: 0, filter: "blur(0px)" },
    exit: { opacity: 0, y: -10, filter: "blur(4px)" },
  };

  return (
    <main className="relative grid min-h-dvh md:grid-cols-[1.05fr_1fr]">
      <Lodge />

      <section className="relative flex min-h-dvh flex-col px-5 py-6 md:px-12 md:py-8">
        <Link href="/" className="flex items-baseline gap-2 self-start md:hidden">
          <span className="text-[16px] font-medium tracking-[0.14em]">FRIDAY</span>
          <span className="label !text-[9.5px]">the job hunter</span>
        </Link>

        <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center gap-8 py-12">
          <AnimatePresence mode="wait" initial={false}>
            {sent ? (
              <motion.div key="sent" {...swap} transition={{ duration: 0.45, ease: EASE_OUT }} className="flex flex-col gap-6">
                <span className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent">{sent.kind === "telegram" ? <Send size={19} strokeWidth={1.6} /> : <Mail size={20} strokeWidth={1.6} />}</span>
                {sent.kind === "telegram" ? (
                  <div className="flex flex-col gap-3">
                    <Label>Sign-in link sent</Label>
                    <h1 className="text-[36px] leading-[1]">Check <span className="serif-em">Telegram</span>.</h1>
                    <p className="text-[14.5px] leading-relaxed text-muted">FRIDAY sent a one-time sign-in link to the Telegram chat linked to <span className="text-text">{sent.email}</span>. Tap <span className="text-text">Sign in to FRIDAY</span> there.</p>
                  </div>
                ) : (
                <div className="flex flex-col gap-3">
                  <Label>{sent.kind === "magic" ? "Sign-in link sent" : "One more step"}</Label>
                  <h1 className="text-[36px] leading-[1]">Check your <span className="serif-em">inbox</span>.</h1>
                  <p className="text-[14.5px] leading-relaxed text-muted">
                    {sent.kind === "magic" ? "Open the link we sent to " : "Confirm your account with the link we sent to "}
                    <span className="text-text">{sent.email}</span>. It can take a minute; check spam if it doesn&apos;t show.
                  </p>
                </div>
                )}
                {sent.kind === "telegram" ? (
                  <a href={sent.bot ? `https://t.me/${sent.bot}` : "https://web.telegram.org"} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center self-start rounded-full bg-[rgb(var(--ink)/.06)] px-4 text-[14px] hairline hover:bg-[rgb(var(--ink)/.1)]">Open Telegram</a>
                ) : (
                <div className="flex flex-wrap gap-2">
                  <a href="https://mail.google.com/mail/u/0/#search/FRIDAY" target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center rounded-full bg-[rgb(var(--ink)/.06)] px-4 text-[14px] hairline hover:bg-[rgb(var(--ink)/.1)]">Open Gmail</a>
                  <a href="https://outlook.office.com/mail/" target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center rounded-full bg-[rgb(var(--ink)/.06)] px-4 text-[14px] hairline hover:bg-[rgb(var(--ink)/.1)]">Open Outlook</a>
                </div>
                )}
                {error && <p role="alert" className="text-[13px] text-amber">{error}</p>}
                <div className="flex items-center justify-between text-[13px]">
                  <button type="button" onClick={() => { setSent(null); setError(null); }} className="inline-flex items-center gap-1.5 text-muted hover:text-text"><ArrowLeft size={14} /> Use a different email</button>
                  <button type="button" onClick={resend} disabled={wait > 0} className="text-muted hover:text-text disabled:text-dim">
                    {wait > 0 ? <>Resend in <span className="num">{wait}</span>s</> : "Resend"}
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div key="form" {...swap} transition={{ duration: 0.45, ease: EASE_OUT }} className="flex flex-col gap-8">
                <div className="flex flex-col gap-3">
                  <Label>{mode === "signup" ? "Join the hunt" : mode === "magic" ? "No password needed" : "Welcome back, hunter"}</Label>
                  <h1 className="text-[40px] leading-[1]">
                    {mode === "signup" ? <>Start the <span className="serif-em">hunt</span>.</> : mode === "magic" ? <>Get a <span className="serif-em">link</span>.</> : <>Back on the <span className="serif-em">trail</span>.</>}
                  </h1>
                  <p className="text-[14px] text-muted">
                    {mode === "magic" ? "We'll email you a one-time link that signs you straight in." : "Use your SJSU email or any email you check."}
                  </p>
                </div>

                {mode !== "magic" && (
                  <div role="tablist" aria-label="Account" className="relative grid grid-cols-2 rounded-full bg-[rgb(var(--ink)/.05)] p-1 hairline">
                    {(["signin", "signup"] as const).map((m) => (
                      <button key={m} role="tab" aria-selected={mode === m} type="button" onClick={() => switchTo(m)} className={cx("relative h-9 rounded-full text-[13.5px] transition-colors duration-150", mode === m ? "text-text" : "text-muted hover:text-text")}>
                        {mode === m && <motion.span layoutId="auth-tab" transition={{ type: "spring", stiffness: 420, damping: 34 }} className="absolute inset-0 rounded-full bg-surface-2 [box-shadow:inset_0_0_0_0.5px_var(--hairline-strong),inset_0_1px_0_var(--highlight)]" />}
                        <span className="relative">{m === "signin" ? "Sign in" : "Create account"}</span>
                      </button>
                    ))}
                  </div>
                )}

                <form onSubmit={submit} className="relative flex flex-col gap-4">
                  {/* honeypot: invisible to people and screen readers; bots that fill it get no account */}
                  <input ref={trap} name="website" tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] size-px opacity-0" />
                  <Field label="Email">
                    <Input type="email" required autoFocus autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@sjsu.edu" className="h-11" />
                  </Field>
                  {mode !== "magic" && (
                    <Field label="Password" hint={mode === "signup" ? "At least 8 characters." : caps ? "Caps Lock is on." : undefined}>
                      <span className="relative block">
                        <Input
                          type={show ? "text" : "password"} required minLength={mode === "signup" ? 8 : undefined}
                          autoComplete={mode === "signup" ? "new-password" : "current-password"}
                          value={password} onChange={(e) => setPassword(e.target.value)}
                          onKeyUp={(e) => setCaps(e.getModifierState("CapsLock"))}
                          className="h-11 pr-11"
                        />
                        <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-dim hover:text-text">
                          {show ? <EyeOff size={16} strokeWidth={1.6} /> : <Eye size={16} strokeWidth={1.6} />}
                        </button>
                      </span>
                    </Field>
                  )}
                  {mode === "signin" && (
                    <button type="button" onClick={() => switchTo("magic")} className="-mt-1 self-end text-[12.5px] text-muted hover:text-text">Forgot password? Get a sign-in link</button>
                  )}
                  {error && <p role="alert" className="text-[13px] leading-snug text-amber">{error}</p>}
                  <Button type="submit" variant="primary" size="lg" disabled={busy} className="mt-1 w-full">
                    {busy && <Loader2 size={16} className="animate-spin" />}
                    {busy ? (mode === "signup" ? (queued ? "Lots of students joining. You\u2019re in line…" : "Creating your account…") : "One moment…") : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Email me a link"}
                  </Button>
                  {mode === "magic" ? (
                    <button type="button" onClick={() => switchTo("signin")} className="inline-flex items-center justify-center gap-1.5 text-[13px] text-muted hover:text-text"><ArrowLeft size={14} /> Back to password sign-in</button>
                  ) : (
                    <button type="button" onClick={() => switchTo("magic")} className="text-[13px] text-muted hover:text-text">Sign in with an email link instead</button>
                  )}
                </form>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <p className="text-center text-[11px] text-dim">An independent student tool. Not affiliated with San José State University.</p>
      </section>
    </main>
  );
}

/** The left panel: a radar sweeping over the campus, and the three promises that matter at the door. */
function Lodge() {
  return (
    <aside className="relative hidden overflow-hidden bg-surface-1 [box-shadow:inset_-0.5px_0_0_var(--hairline-strong)] md:flex md:flex-col md:justify-between md:p-10 lg:p-14">
      <Link href="/" className="relative z-10 flex items-baseline gap-2.5">
        <span className="text-[17px] font-medium tracking-[0.16em]">FRIDAY</span>
        <span className="label !text-[9.5px]">the job hunter</span>
      </Link>

      <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[118%] -translate-x-1/2 -translate-y-1/2">
        {[1, 0.74, 0.48, 0.22].map((s) => (
          <span key={s} className="absolute inset-0 m-auto rounded-full [box-shadow:inset_0_0_0_0.5px_var(--hairline-strong)]" style={{ width: `${s * 100}%`, height: `${s * 100}%` }} />
        ))}
        <span className="absolute inset-x-0 top-1/2 h-px bg-hairline" />
        <span className="absolute inset-y-0 left-1/2 w-px bg-hairline" />
        <span className="radar absolute inset-0 rounded-full [background:conic-gradient(from_0deg,rgb(217_164_65/.22),transparent_16%)]" />
        <span className="blip absolute left-[63%] top-[38%] size-2 rounded-full bg-accent" />
        <span className="blip absolute left-[34%] top-[61%] size-1.5 rounded-full bg-accent [animation-delay:1.9s]" />
      </div>

      <div className="relative z-10 flex flex-col gap-8">
        <h2 className="max-w-[14ch] text-[52px] font-[450] leading-[0.94] tracking-[-0.04em] lg:text-[64px]">
          The jobs move <span className="serif-em">fast</span>. So does FRIDAY.
        </h2>
        <div className="grid grid-cols-3 gap-6 [box-shadow:inset_0_0.5px_0_var(--hairline-strong)] pt-6">
          {[["Every minute", "SJSU pages checked"], ["0", "applications sent without you"], ["100%", "resume facts from you"]].map(([v, k]) => (
            <div key={k} className="flex flex-col gap-1.5">
              <p className="num text-[22px] font-[450] tracking-[-0.02em]">{v}</p>
              <p className="label !normal-case !tracking-normal !text-[12px]">{k}</p>
            </div>
          ))}
        </div>
      </div>
      <style>{`
        @keyframes sweep { to { transform: rotate(360deg); } }
        .radar { animation: sweep 6s linear infinite; }
        @keyframes blip { 0%, 70%, 100% { opacity: 0; transform: scale(.6); } 8% { opacity: 1; transform: scale(1); } 40% { opacity: .2; } }
        .blip { animation: blip 6s cubic-bezier(.32,.72,0,1) infinite; box-shadow: 0 0 0 6px var(--accent-soft); }
        @media (prefers-reduced-motion: reduce) { .radar, .blip { animation: none; } .blip { opacity: .8; } }
      `}</style>
    </aside>
  );
}
