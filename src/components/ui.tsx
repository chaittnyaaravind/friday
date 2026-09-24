import clsx from "clsx";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { ScrollFade } from "./motion";

export { clsx as cx };

// ───────────────────────── Buttons ─────────────────────────
type Variant = "primary" | "secondary" | "ghost" | "quiet";
const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap select-none transition-[background-color,box-shadow,color,transform] duration-150 ease-[var(--ease-hover)] active:scale-[.97] disabled:opacity-45 disabled:pointer-events-none";
const sizes = { sm: "h-8 px-3.5 text-[13px]", md: "h-10 px-[18px] text-[14px]", lg: "h-12 px-6 text-[15px]" };
const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover shadow-[inset_0_1px_0_rgb(255_255_255/.18)]",
  secondary: "bg-[rgb(var(--ink)/.06)] text-text hairline hover:bg-[rgb(var(--ink)/.1)]",
  ghost: "text-muted hover:text-text hover:bg-[rgb(var(--ink)/.06)]",
  quiet: "bg-text text-bg hover:opacity-90",
};

export function Button({ variant = "secondary", size = "md", className, ...rest }: ComponentProps<"button"> & { variant?: Variant; size?: keyof typeof sizes }) {
  return <button className={clsx(base, sizes[size], variants[variant], className)} {...rest} />;
}

export function LinkButton({ variant = "secondary", size = "md", className, external, ...rest }: ComponentProps<typeof Link> & { variant?: Variant; size?: keyof typeof sizes; external?: boolean }) {
  const cls = clsx(base, sizes[size], variants[variant], className);
  if (external) {
    const { href, ...a } = rest as ComponentProps<"a"> & { href: string };
    return <a href={href} target="_blank" rel="noopener noreferrer" className={cls} {...a} />;
  }
  return <Link className={cls} {...rest} />;
}

// ───────────────────────── Surfaces ─────────────────────────
export function Card({ className, interactive, ...rest }: ComponentProps<"div"> & { interactive?: boolean }) {
  return <div className={clsx("card", interactive && "card-hover", className)} {...rest} />;
}

export function Label({ className, ...rest }: ComponentProps<"span">) {
  return <span className={clsx("label", className)} {...rest} />;
}

export function SectionHeader({ eyebrow, title, action, className }: { eyebrow?: string; title: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={clsx("flex items-end justify-between gap-4", className)}>
      <div className="flex flex-col gap-2">
        {eyebrow && <Label>{eyebrow}</Label>}
        <h2 className="text-[22px] leading-[1.1] md:text-[26px]">{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ eyebrow, title, sub, actions }: { eyebrow: string; title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <ScrollFade>
    <header className="reveal flex flex-col gap-5 pb-8 md:flex-row md:items-end md:justify-between md:pb-10">
      <div className="flex max-w-[640px] flex-col gap-3">
        <Label>{eyebrow}</Label>
        <h1 className="text-[34px] leading-[1.02] md:text-[46px]">{title}</h1>
        {sub && <p className="max-w-[56ch] text-[15px] leading-relaxed text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
    </ScrollFade>
  );
}

// ───────────────────────── Chips ─────────────────────────
type Tone = "neutral" | "moss" | "accent" | "amber";
const tones: Record<Tone, string> = {
  neutral: "bg-[rgb(var(--ink)/.06)] text-muted",
  moss: "bg-moss-soft text-moss",
  accent: "bg-accent-soft text-accent",
  amber: "bg-amber-soft text-amber",
};
export function Chip({ tone = "neutral", className, children, icon }: { tone?: Tone; className?: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <span className={clsx("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium leading-none", tones[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

// ───────────────────────── Forms ─────────────────────────
const field =
  "w-full rounded-[10px] bg-surface-2 px-3.5 text-[14px] text-text placeholder:text-dim hairline outline-none transition-[box-shadow] duration-150 focus:shadow-[inset_0_0_0_1px_var(--accent),0_0_0_3px_var(--accent-soft)]";
export function Input({ className, ...rest }: ComponentProps<"input">) {
  return <input className={clsx(field, "h-10", className)} {...rest} />;
}
export function Textarea({ className, ...rest }: ComponentProps<"textarea">) {
  return <textarea className={clsx(field, "min-h-28 py-2.5 leading-relaxed", className)} {...rest} />;
}
export function Select({ className, children, ...rest }: ComponentProps<"select">) {
  return (
    <select className={clsx(field, "h-10 appearance-none bg-[length:12px] bg-[right_12px_center] bg-no-repeat pr-9", className)} style={{ backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' fill='none' stroke='%23a08f7d' stroke-width='1.5'><path d='M3 4.5 6 7.5 9 4.5'/></svg>\")" }} {...rest}>
      {children}
    </select>
  );
}
export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={clsx("flex flex-col gap-2", className)}>
      <Label>{label}</Label>
      {children}
      {hint && <span className="text-[12px] leading-snug text-dim">{hint}</span>}
    </label>
  );
}

// ───────────────────────── Identity ─────────────────────────
/** Monogram instead of third-party logo fetches: no tracking pixels, never broken. */
export function CompanyMark({ name, size = 36, className }: { name: string; size?: number; className?: string }) {
  const letters = name.replace(/^SJSU\s+/, "").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const isSjsu = name.startsWith("SJSU");
  return (
    <span
      aria-hidden
      className={clsx("inline-grid shrink-0 place-items-center rounded-[10px] font-mono text-[11px] font-medium tracking-wider", isSjsu ? "bg-accent-soft text-accent" : "bg-surface-3 text-muted", className)}
      style={{ width: size, height: size, boxShadow: "inset 0 0 0 0.5px var(--hairline-strong)" }}
    >
      {letters}
    </span>
  );
}

export function MatchBadge({ score, className }: { score: number | null | undefined; className?: string }) {
  if (score == null) return null;
  const tier = score >= 75 ? "Strong" : score >= 55 ? "Good" : "Stretch";
  const color = score >= 75 ? "text-moss" : score >= 55 ? "text-text" : "text-dim";
  return (
    <span className={clsx("inline-flex items-baseline gap-1.5", className)} title={`${score}/100 — see "Why this matches"`}>
      <span className={clsx("num font-mono text-[15px] font-medium", color)}>{score}</span>
      <span className="label">{tier}</span>
    </span>
  );
}

export function EmptyState({ title, body, action, className }: { title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <Card className={clsx("flex flex-col items-start gap-3 p-7", className)}>
      <div className="rule-dashed w-16" />
      <h3 className="text-[18px]">{title}</h3>
      {body && <p className="max-w-[52ch] text-[14px] leading-relaxed text-muted">{body}</p>}
      {action}
    </Card>
  );
}

export function Notice({ tone = "neutral", title, children, className }: { tone?: Tone; title: string; children?: ReactNode; className?: string }) {
  const bar = { neutral: "bg-hairline-strong", moss: "bg-moss", accent: "bg-accent", amber: "bg-amber" }[tone];
  return (
    <div className={clsx("card relative overflow-hidden py-3.5 pl-5 pr-4", className)}>
      <span className={clsx("absolute inset-y-3 left-0 w-[2px] rounded-full", bar)} />
      <p className="text-[14px] font-medium">{title}</p>
      {children && <div className="mt-1 text-[13px] leading-relaxed text-muted">{children}</div>}
    </div>
  );
}
