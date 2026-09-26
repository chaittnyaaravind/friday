"use client";
import { useEffect, useState, type ReactNode } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/client";

/** Keep already-rendered tabs in sync with server sign-out and expired sessions. */
export function SessionGuard({ children }: { children: ReactNode }) {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    let disposed = false, pending = false;
    const leave = () => { if (disposed) return; setExpired(true); window.location.replace("/login"); };
    const check = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try { const response = await fetch("/api/auth/session", { cache: "no-store" }); if (response.status === 401) leave(); } catch { /* A network failure is not proof of logout. */ }
      finally { pending = false; }
    };
    const onStorage = (e: StorageEvent) => { if (e.key === "friday-signout") leave(); };
    const onSubmit = async (e: SubmitEvent) => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement) || new URL(form.action).pathname !== "/auth/signout") return;
      e.preventDefault();
      const button = form.querySelector("button");
      if (button?.disabled) return;
      if (button) button.disabled = true;
      try {
        const response = await fetch("/auth/signout", { method: "POST" });
        if (!response.ok) throw new Error("Sign-out failed. Please try again.");
        try { localStorage.setItem("friday-signout", String(Date.now())); } catch { /* Other tabs also recheck on focus. */ }
        leave();
      } catch {
        if (button) { button.disabled = false; button.textContent = "Sign-out failed. Retry"; }
      }
    };
    const supabase = createSupabaseBrowser();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => { if (event === "SIGNED_OUT") leave(); });
    document.addEventListener("submit", onSubmit);
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    const timer = setInterval(check, 30000);
    return () => {disposed = true; clearInterval(timer); subscription.unsubscribe(); document.removeEventListener("submit", onSubmit); window.removeEventListener("storage", onStorage); window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check);};
  }, []);
  return expired ? null : children;
}
