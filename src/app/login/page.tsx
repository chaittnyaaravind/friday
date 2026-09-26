"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, useRef } from "react";
import { Button, Field, Input, Label, cx } from "@/components/ui";
import { safeNextPath } from "@/lib/auth/safe-next";
import { createSupabaseBrowser } from "@/lib/supabase/client";

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
  const next = safeNextPath(sp.get("next"));
  const [mode, setMode] = useState<"signin" | "signup" | "magic">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(sp.get("error") ? { ok: false, text: sp.get("error")! } : null);

  const submitting = useRef(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setMsg(null);
    const supabase = createSupabaseBrowser();
    // Email links point at the configured public site (the Vercel app); fall back to wherever this page is served from.
    const site = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") || window.location.origin;
    const redirect = `${site}/auth/callback?next=${encodeURIComponent(next)}`;
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace(next);
        router.refresh();
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirect } });
        if (error) throw error;
        if (data.session) {
          router.replace("/onboarding");
          router.refresh();
        } else setMsg({ ok: true, text: `Check ${email} to confirm your account.` });
      } else {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
        if (error) throw error;
        setMsg({ ok: true, text: `Sign-in link sent to ${email}.` });
      }
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-4 py-16">
      <div aria-hidden className="pointer-events-none absolute inset-0 [background:radial-gradient(60%_50%_at_50%_0%,var(--accent-soft),transparent_70%)]" />
      <Link href="/" className="absolute left-5 top-5 text-[16px] font-medium tracking-[0.14em] md:left-8 md:top-7">FRIDAY</Link>
      <div className="reveal relative flex w-full max-w-[400px] flex-col gap-8">
        <div className="flex flex-col gap-3">
          <Label>{mode === "signup" ? "Create account" : "Welcome back"}</Label>
          <h1 className="text-[40px] leading-[1]">
            {mode === "signup" ? <>Start your <span className="serif-em">search</span>.</> : <>Sign <span className="serif-em">in</span>.</>}
          </h1>
          <p className="text-[14px] text-muted">Use your SJSU email or any email you check.</p>
        </div>
        <form onSubmit={submit} className="card flex flex-col gap-4 p-6">
          <Field label="Email"><Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@sjsu.edu" /></Field>
          {mode !== "magic" && (
            <Field label="Password" hint={mode === "signup" ? "At least 8 characters." : undefined}>
              <Input type="password" required minLength={mode === "signup" ? 8 : undefined} autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          )}
          {msg && <p className={cx("text-[13px]", msg.ok ? "text-moss" : "text-accent")}>{msg.text}</p>}
          <Button type="submit" variant="primary" size="lg" disabled={busy}>
            {busy && <Loader2 size={16} className="animate-spin" />}
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Email me a link"}
          </Button>
          <button type="button" onClick={() => setMode(mode === "magic" ? "signin" : "magic")} className="text-[13px] text-muted hover:text-text">
            {mode === "magic" ? "Use a password instead" : "Email me a sign-in link instead"}
          </button>
        </form>
        <p className="text-center text-[13.5px] text-muted">
          {mode === "signup" ? "Already have an account? " : "New to FRIDAY? "}
          <button onClick={() => setMode(mode === "signup" ? "signin" : "signup")} className="text-text underline decoration-hairline-strong underline-offset-4">
            {mode === "signup" ? "Sign in" : "Create an account"}
          </button>
        </p>
      </div>
      <p className="absolute bottom-5 px-4 text-center text-[11px] text-dim">An independent student tool. Not affiliated with San José State University.</p>
    </main>
  );
}
