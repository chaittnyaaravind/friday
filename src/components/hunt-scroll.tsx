"use client";

/**
 * The landing page's scroll story. Three pieces, each scroll-linked and each degrading to a still frame:
 *   BigWord   — one absurd-size outlined word that drifts sideways as you pass it (the section break).
 *   HuntTrail — a pinned run through the hunt, one step per stretch of scroll, with a gold trail drawing behind it.
 *   Torch     — the SJSU hiring pages sit in the dark; a torch follows the pointer (or sweeps with scroll on touch).
 */
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll, useSpring, useTransform } from "motion/react";
import { useRef, useState } from "react";
import { EASE_OUT } from "./motion";

export function BigWord({ word }: { word: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const x = useTransform(scrollYProgress, [0, 1], reduced ? ["0%", "0%"] : ["8%", "-28%"]);
  return (
    <div ref={ref} aria-hidden className="relative z-10 overflow-hidden py-10 md:py-16">
      <motion.p
        style={{ x }}
        className="whitespace-nowrap text-[34vw] font-[450] uppercase leading-[0.8] tracking-[-0.04em] text-transparent [-webkit-text-stroke:1px_var(--hairline-strong)] md:text-[26vw]"
      >
        {word}
      </motion.p>
    </div>
  );
}

export type TrailStep = { name: string; body: string; yours?: boolean };

export function HuntTrail({ steps }: { steps: TrailStep[] }) {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const draw = useSpring(scrollYProgress, { stiffness: 140, damping: 30 });
  const [at, setAt] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (v) => setAt(Math.min(steps.length - 1, Math.max(0, Math.floor(v * steps.length)))));
  const step = steps[at];

  return (
    <section ref={ref} className="relative z-10" style={{ height: `${steps.length * 60 + 60}vh` }}>
      <div className="sticky top-0 mx-auto flex h-dvh max-w-[1240px] flex-col justify-center gap-10 px-5 md:px-10">
        <div className="flex items-baseline justify-between">
          <span className="label">The hunt</span>
          <span className="label num">{String(at + 1).padStart(2, "0")} / {String(steps.length).padStart(2, "0")}</span>
        </div>

        <div className="relative min-h-[46vh] md:min-h-[40vh]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={at}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 28, filter: "blur(8px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -20, filter: "blur(6px)" }}
              transition={{ duration: 0.5, ease: EASE_OUT }}
              className="flex flex-col gap-6"
            >
              <span className={`num font-mono text-[13px] ${step.yours ? "text-accent" : "text-dim"}`}>{step.yours ? "Your call" : `Step ${at + 1}`}</span>
              <h3 className={`text-[64px] font-[450] leading-[0.9] tracking-[-0.045em] md:text-[132px] ${step.yours ? "serif-em text-accent" : ""}`}>{step.name}</h3>
              <p className="max-w-[46ch] text-[17px] leading-relaxed text-muted md:text-[19px]">{step.body}</p>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* the trail: hairline track, gold line drawn by scroll, one mark per step */}
        <div className="relative">
          <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-hairline-strong" />
          <motion.div className="absolute inset-x-0 top-1/2 h-px origin-left -translate-y-1/2 bg-accent" style={{ scaleX: draw }} />
          <ol className="relative flex justify-between">
            {steps.map((s, i) => (
              <li key={s.name} className="flex flex-col items-center gap-3">
                <span className={`size-2.5 rounded-full transition-[background-color,box-shadow] duration-300 ${i <= at ? "bg-accent shadow-[0_0_0_4px_var(--accent-soft)]" : "bg-surface-3"}`} />
                <span className={`label hidden !text-[9.5px] md:block ${i === at ? "!text-text" : ""}`}>{s.name}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

export function Torch({ items, caption }: { items: string[]; caption: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  // Touch screens have no pointer to follow, so the torch sweeps across with the scroll instead.
  useMotionValueEvent(scrollYProgress, "change", (v) => {
    const el = ref.current;
    if (!el || el.dataset.pointer === "1") return;
    el.style.setProperty("--tx", `${(reduced ? 50 : 10 + v * 80).toFixed(1)}%`);
    el.style.setProperty("--ty", `${(reduced ? 50 : 20 + v * 60).toFixed(1)}%`);
  });
  const follow = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.dataset.pointer = "1";
    el.style.setProperty("--tx", `${e.clientX - r.left}px`);
    el.style.setProperty("--ty", `${e.clientY - r.top}px`);
  };
  const names = (bright: boolean) => (
    <ul className="flex flex-wrap gap-x-6 gap-y-2 text-[28px] font-[450] leading-[1.1] tracking-[-0.03em] md:gap-x-10 md:text-[52px]">
      {items.map((n) => <li key={n} className={bright ? "text-text" : "text-[rgb(var(--ink)/.09)]"}>{n}</li>)}
    </ul>
  );

  return (
    <div
      ref={ref}
      onPointerMove={follow}
      onPointerLeave={(e) => { delete e.currentTarget.dataset.pointer; }}
      className="card relative overflow-hidden p-6 md:p-12"
      style={{ ["--tx" as string]: "50%", ["--ty" as string]: "50%" }}
    >
      <p className="label mb-8">{caption}</p>
      {names(false)}
      {/* the lit copy: same layout over the whole card, so the mask's coordinates are the card's */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 p-6 md:p-12"
        style={{
          maskImage: "radial-gradient(circle 190px at var(--tx) var(--ty), #000 25%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(circle 190px at var(--tx) var(--ty), #000 25%, transparent 100%)",
        }}
      >
        <p className="label invisible mb-8">{caption}</p>
        {names(true)}
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-0 [background:radial-gradient(circle_260px_at_var(--tx)_var(--ty),rgb(217_164_65/.08),transparent_70%)]" />
    </div>
  );
}
