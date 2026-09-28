import Link from "next/link";
import { HUNT_TABS, WINDOWS, WINDOW_LABEL, type HuntTab, type HuntWindow } from "@/lib/domain/hunt";
import { cx } from "./ui";

/** The four hunt views, plus the first-seen window when "Just opened" is selected. Plain links: no client JavaScript. */
export function HuntNav({ tab, window }: { tab: HuntTab; window: HuntWindow }) {
  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="Hunt views" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0">
        {HUNT_TABS.map((t) => (
          <Link
            key={t.id}
            href={t.id === "just-opened" ? `/hunt?tab=just-opened&window=${window}` : `/hunt?tab=${t.id}`}
            aria-current={t.id === tab ? "page" : undefined}
            className={cx("h-8 shrink-0 rounded-full px-3.5 text-[13px] leading-8 transition-[background-color,color] duration-150", t.id === tab ? "bg-text text-bg" : "text-muted hairline hover:text-text")}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === "just-opened" && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="First seen within">
          <span className="label">First seen within</span>
          {(Object.keys(WINDOWS) as HuntWindow[]).map((w) => (
            <Link
              key={w}
              href={`/hunt?tab=just-opened&window=${w}`}
              aria-current={w === window ? "true" : undefined}
              className={cx("num h-7 rounded-full px-3 font-mono text-[12px] leading-7 transition-[background-color,color] duration-150", w === window ? "bg-[rgb(var(--ink)/.12)] text-text" : "text-muted hairline hover:text-text")}
            >
              {WINDOW_LABEL[w]}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
