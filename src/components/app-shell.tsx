"use client";

import {
  Bell, Briefcase, Building2, CalendarDays, Compass, FileText, GraduationCap, LayoutGrid, ListChecks, Menu, MessageSquare, Moon, Settings, Sun, SunMoon, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { ago } from "@/lib/format";
import { cx } from "./ui";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/sjsu", label: "SJSU Jobs", icon: GraduationCap },
  { href: "/internships", label: "Internships", icon: Briefcase },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/applications", label: "Applications", icon: ListChecks },
  { href: "/resume", label: "Resume", icon: FileText },
  { href: "/chat", label: "FRIDAY AI", icon: MessageSquare },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;
const MOBILE = ["/dashboard", "/discover", "/sjsu", "/applications", "/chat"];

type Note = { id: string; kind: string; title: string; body: string | null; job_id: string | null; application_id: string | null; read_at: string | null; created_at: string };

export function AppShell({ children, name }: { children: ReactNode; name: string | null }) {
  const path = usePathname();
  // The mobile menu remembers which page it was opened on, so navigating closes it.
  const [moreAt, setMoreAt] = useState<string | null>(null);
  const more = moreAt === path;
  const setMore = (fn: (m: boolean) => boolean) => setMoreAt(fn(more) ? path : null);
  const active = (href: string) => path === href || path.startsWith(href + "/");

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[232px_1fr]">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col gap-1 border-r-[0.5px] border-hairline-strong px-3 py-5 md:flex">
        <Link href="/dashboard" className="mb-6 flex items-baseline gap-2 px-3">
          <span className="text-[19px] font-medium tracking-[0.14em]">FRIDAY</span>
          <span className="label !text-[9.5px]">for SJSU</span>
        </Link>
        <nav className="flex flex-col gap-0.5">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cx(
                "group relative flex h-9 items-center gap-3 rounded-[10px] px-3 text-[14px] transition-colors duration-150",
                active(href) ? "bg-[rgb(var(--ink)/.07)] text-text" : "text-muted hover:bg-[rgb(var(--ink)/.04)] hover:text-text",
              )}
            >
              {active(href) && <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-accent" />}
              <Icon size={16} strokeWidth={1.6} className={active(href) ? "text-text" : "text-dim group-hover:text-muted"} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex items-center justify-between gap-2 px-2 pt-4">
          <div className="min-w-0">
            <p className="label">Signed in</p>
            <p className="truncate text-[13px] text-muted">{name ?? "SJSU student"}</p>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Notifications />
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between bg-glass px-4 backdrop-blur-xl backdrop-saturate-150 [box-shadow:inset_0_-0.5px_0_var(--hairline-strong)] md:hidden">
        <Link href="/dashboard" className="text-[16px] font-medium tracking-[0.14em]">FRIDAY</Link>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Notifications />
          <button aria-label="Menu" onClick={() => setMore((m) => !m)} className="grid size-9 place-items-center rounded-full text-muted hover:text-text">
            {more ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </header>
      {more && (
        <div className="fixed inset-x-3 top-16 z-40 grid grid-cols-2 gap-1 rounded-2xl bg-glass p-2 backdrop-blur-xl [box-shadow:inset_0_0_0_0.5px_var(--hairline-strong),var(--shadow)] md:hidden">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={cx("flex h-11 items-center gap-2.5 rounded-xl px-3 text-[14px]", active(href) ? "bg-[rgb(var(--ink)/.08)] text-text" : "text-muted")}>
              <Icon size={16} strokeWidth={1.6} />
              {label}
            </Link>
          ))}
        </div>
      )}

      <main className="min-w-0 px-4 pb-28 pt-6 sm:px-6 md:px-10 md:pb-16 md:pt-10 lg:px-14">
        <div className="mx-auto w-full max-w-[1180px]">{children}</div>
      </main>

      {/* Mobile tab bar */}
      <nav className="fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-40 flex h-16 items-stretch justify-around rounded-[22px] bg-glass px-1 backdrop-blur-xl backdrop-saturate-150 [box-shadow:inset_0_0_0_0.5px_var(--hairline-strong),var(--shadow)] md:hidden">
        {NAV.filter((n) => MOBILE.includes(n.href)).map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={cx("flex flex-1 flex-col items-center justify-center gap-1 rounded-2xl text-[10.5px]", active(href) ? "text-text" : "text-dim")}>
            <Icon size={19} strokeWidth={active(href) ? 1.9 : 1.5} />
            <span className={cx(active(href) && "font-medium")}>{label === "FRIDAY AI" ? "FRIDAY" : label.replace(" Jobs", "")}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

const themeSub = (cb: () => void) => {
  window.addEventListener("friday-theme", cb);
  return () => window.removeEventListener("friday-theme", cb);
};
const themeSnap = () => (document.documentElement.dataset.theme as "light" | "dark" | undefined) ?? "system";

function ThemeToggle() {
  // The inline script in the root layout applies the saved theme before paint; read it from the DOM.
  const mode = useSyncExternalStore(themeSub, themeSnap, () => "system" as const);
  const cycle = () => {
    const next = mode === "system" ? "light" : mode === "light" ? "dark" : "system";
    try {
      if (next === "system") {
        localStorage.removeItem("friday-theme");
        delete document.documentElement.dataset.theme;
      } else {
        localStorage.setItem("friday-theme", next);
        document.documentElement.dataset.theme = next;
      }
    } catch {}
    window.dispatchEvent(new Event("friday-theme"));
  };
  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : SunMoon;
  return (
    <button onClick={cycle} aria-label={`Theme: ${mode}`} title={`Theme: ${mode}`} className="grid size-9 place-items-center rounded-full text-dim transition-colors hover:text-text">
      <Icon size={16} strokeWidth={1.6} />
    </button>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ notifications: Note[]; unread: number } | null>(null);
  const load = () => fetch("/api/notifications").then((r) => (r.ok ? r.json() : null)).then(setData).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, []);
  const markAll = async () => {
    await fetch("/api/notifications", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ all: true }) });
    load();
  };
  const href = (n: Note) => (n.job_id ? `/jobs/${n.job_id}` : n.application_id ? `/applications?open=${n.application_id}` : "/dashboard");

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="Notifications" className="relative grid size-9 place-items-center rounded-full text-dim transition-colors hover:text-text">
        <Bell size={16} strokeWidth={1.6} />
        {!!data?.unread && <span className="absolute right-2 top-2 size-1.5 rounded-full bg-accent" />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed inset-x-3 top-16 z-50 max-h-[70dvh] overflow-auto rounded-2xl bg-glass backdrop-blur-xl [box-shadow:inset_0_0_0_0.5px_var(--hairline-strong),var(--shadow)] md:absolute md:inset-x-auto md:bottom-11 md:left-0 md:top-auto md:w-[360px]">
            <div className="flex items-center justify-between px-4 pb-2 pt-3.5">
              <span className="label">Alerts</span>
              {!!data?.unread && <button onClick={markAll} className="text-[12px] text-muted hover:text-text">Mark all read</button>}
            </div>
            {!data?.notifications?.length ? (
              <p className="px-4 pb-5 pt-1 text-[13px] text-muted">Nothing yet. FRIDAY checks every morning and tells you when something matches.</p>
            ) : (
              <ul className="pb-2">
                {data.notifications.map((n) => (
                  <li key={n.id}>
                    <Link href={href(n)} onClick={() => setOpen(false)} className="flex gap-3 px-4 py-2.5 hover:bg-[rgb(var(--ink)/.05)]">
                      <span className={cx("mt-1.5 size-1.5 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-accent")} />
                      <span className="min-w-0">
                        <span className="block text-[13.5px] leading-snug">{n.title}</span>
                        {n.body && <span className="block truncate text-[12.5px] text-muted">{n.body}</span>}
                        <span className="label mt-1 block !text-[9.5px]">{ago(n.created_at)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
