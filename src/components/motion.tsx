"use client";

/**
 * FRIDAY motion system (Motion for React). One easing family, restrained ranges:
 * reveals rise 18px with a blur-to-sharp, stagger 60ms, play once. Scroll-linked
 * effects use useScroll/useTransform (hardware-accelerated ScrollTimeline where
 * available). Reduced motion keeps opacity and drops movement.
 */
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
  type Variants,
} from "motion/react";
import { Children, Fragment, useEffect, useRef, type ReactNode } from "react";

export const EASE_OUT = [0.32, 0.72, 0, 1] as const;

const rise = (reduced: boolean | null, y = 18): Variants => ({
  hidden: reduced ? { opacity: 0 } : { opacity: 0, y, filter: "blur(6px)" },
  show: reduced ? { opacity: 1 } : { opacity: 1, y: 0, filter: "blur(0px)" },
});

/** Fades + rises into view once, when ~15% visible. */
export function Reveal({ children, delay = 0, y = 18, className, as = "div" }: { children: ReactNode; delay?: number; y?: number; className?: string; as?: "div" | "section" | "li" }) {
  const reduced = useReducedMotion();
  const Comp = motion[as];
  return (
    <Comp
      className={className}
      variants={rise(reduced, y)}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.7, ease: EASE_OUT, delay }}
    >
      {children}
    </Comp>
  );
}

/** Staggers its direct children into view as the group scrolls in. */
export function Stagger({ children, className, gap = 0.06 }: { children: ReactNode; className?: string; gap?: number }) {
  const reduced = useReducedMotion();
  const item = rise(reduced, 22);
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.05 }}
      variants={{ show: { transition: { staggerChildren: reduced ? 0 : gap } } }}
    >
      {Children.map(children, (child, i) =>
        child == null ? null : (
          <motion.div key={i} variants={item} transition={{ duration: 0.65, ease: EASE_OUT }} className="h-full">
            {child}
          </motion.div>
        ),
      )}
    </motion.div>
  );
}

/** Page header that drifts up and fades as you scroll past it — depth without noise. */
export function ScrollFade({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [0, -48]);
  const opacity = useTransform(scrollYProgress, [0, 0.85], [1, 0.15]);
  return (
    <motion.div ref={ref} className={className} style={reduced ? undefined : { y, opacity }}>
      {children}
    </motion.div>
  );
}

/** Thin accent line tracking page scroll. */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30, restDelta: 0.001 });
  return <motion.div aria-hidden className="fixed inset-x-0 top-0 z-[70] h-[2px] origin-left bg-accent" style={{ scaleX }} />;
}

/** Counts up to `value` the first time it scrolls into view (tabular, no layout shift). */
export function CountUp({ value, className, suffix = "" }: { value: number; className?: string; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduced = useReducedMotion();
  const mv = useMotionValue(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced || !inView) {
      el.textContent = `${reduced ? value : 0}${suffix}`;
      return;
    }
    const unsub = mv.on("change", (v) => (el.textContent = `${Math.round(v)}${suffix}`));
    const controls = animate(mv, value, { duration: 1.1, ease: EASE_OUT });
    return () => {
      unsub();
      controls.stop();
    };
  }, [inView, reduced, value, suffix, mv]);
  return (
    <span ref={ref} className={className}>
      0{suffix}
    </span>
  );
}

/** Scroll-linked word reveal inside a sticky stage (based on Motion's "Scroll word reveal"). */
export function WordReveal({ text, highlight = [], kicker, className }: { text: string; highlight?: string[]; kicker?: string; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const bar = useSpring(scrollYProgress, { stiffness: 120, damping: 30 });
  const words = text.split(" ");
  return (
    <section ref={ref} className={`relative min-h-[220vh] ${className ?? ""}`} aria-label={text}>
      <div className="sticky top-0 flex min-h-dvh items-center">
        <div className="grid w-full grid-cols-1 gap-8 md:grid-cols-[1px_1fr] md:gap-12">
          <div aria-hidden className="relative hidden h-28 w-px overflow-hidden bg-hairline-strong md:block">
            <motion.span className="absolute inset-0 origin-top bg-accent" style={{ scaleY: reduced ? 1 : bar }} />
          </div>
          <div className="flex flex-col gap-8">
            {kicker && <span className="label">{kicker}</span>}
            <p aria-hidden className="max-w-[22ch] text-[40px] font-[450] leading-[1.06] tracking-[-0.04em] md:text-[68px]">
              {words.map((w, i) => (
                <Fragment key={i}>
                  <Word progress={scrollYProgress} index={i} count={words.length} reduced={Boolean(reduced)} accent={highlight.includes(w.replace(/[.,]/g, ""))}>
                    {w}
                  </Word>
                  {i < words.length - 1 ? " " : null}
                </Fragment>
              ))}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Word({ children, progress, index, count, reduced, accent }: { children: string; progress: MotionValue<number>; index: number; count: number; reduced: boolean; accent: boolean }) {
  const start = count <= 1 ? 0 : (index / (count - 1)) * 0.8;
  const end = Math.min(1, start + 0.2);
  const opacity = useTransform(progress, [start, end], [0.14, 1]);
  return (
    <motion.span style={reduced ? undefined : { opacity }} className={accent ? "serif-em text-accent" : undefined}>
      {children}
    </motion.span>
  );
}
