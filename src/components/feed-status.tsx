import { Notice } from "./ui";

/** Shown above FRIDAY's own results when the last run could not reach Adzuna. Other sources are unaffected. */
export function ProviderNotice({ adzunaDown }: { adzunaDown: boolean }) {
  if (!adzunaDown) return null;
  return (
    <Notice tone="amber" title="Adzuna is temporarily unavailable">
      Your other job sources are still working — employers and SJSU&apos;s official pages keep updating.
    </Notice>
  );
}

/** Adzuna asks that listings it supplies be credited. Shown under the feed. */
export function Attribution() {
  return (
    <p className="text-[11.5px] leading-relaxed text-dim">
      Some listings are provided by{" "}
      <a href="https://www.adzuna.com" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-text">Adzuna</a>. Every listing links to its original posting.
    </p>
  );
}
