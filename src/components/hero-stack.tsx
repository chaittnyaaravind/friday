"use client";

import { Check, AlertTriangle } from "lucide-react";
import { motion, motionValue, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from "motion/react";
import { useEffect, useRef } from "react";

/** Real listings FRIDAY discovered during development — shown as a product preview, not live data. */
const STATIC_ZERO = motionValue(0);

const CARDS = [
  { co: "SJSU King Library", title: "IT Helpdesk Student Assistant", meta: "SJSU Campus · On-campus", score: 91, ok: ["On campus", "Student role"], miss: [] as string[] },
  { co: "SJSU Associated Students", title: "Counter Clerk", meta: "SJSU Campus · $18.45/hr", score: 72, ok: ["Front desk", "Customer service"], miss: ["Cash handling"] },
  { co: "SJSU Parking Services", title: "Parking Services Office Student Assistant", meta: "SJSU Campus · $18/hr", score: 67, ok: ["Front desk", "Desk-based"], miss: ["Microsoft Office"] },
];

export function HeroStack() {
  const stage = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  // Scroll-linked: as the hero scrolls away the deck fans out in depth and tilts toward you.
  const { scrollY } = useScroll();
  const raw = useTransform(scrollY, [0, 640], [0, 1], { clamp: true });
  const spread = useSpring(raw, { stiffness: 90, damping: 24, mass: 0.6 });

  useEffect(() => {
    const el = stage.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let tx = 0, ty = 0, x = 0, y = 0;
    const onMove = (e: PointerEvent) => {
      tx = (e.clientX / window.innerWidth - 0.5) * 2;
      ty = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    const tick = () => {
      x += (tx - x) * 0.06;
      y += (ty - y) * 0.06;
      el.style.setProperty("--rx", `${(-y * 6).toFixed(2)}deg`);
      el.style.setProperty("--ry", `${(x * 9).toFixed(2)}deg`);
      el.style.setProperty("--sx", `${(-spread.get() * 10).toFixed(2)}deg`);
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, [spread]);

  return (
    <div className="relative mx-auto aspect-[4/3.8] w-full max-w-[520px] [perspective:1400px]">
      <div
        ref={stage}
        className="absolute inset-0 [transform-style:preserve-3d]"
        style={{ transform: "rotateX(calc(14deg + var(--rx, 0deg) + var(--sx, 0deg))) rotateY(calc(-18deg + var(--ry, 0deg)))" }}
      >
        {CARDS.map((c, i) => (
          <DeckCard key={c.title} i={i} spread={reduced ? null : spread}>
            <div className="card flex flex-col gap-3 p-4 [box-shadow:inset_0_0_0_0.5px_var(--hairline-strong),inset_0_1px_0_var(--highlight),0_30px_60px_-30px_rgb(0_0_0/.8)]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[12px] text-muted">{c.co}</p>
                  <p className="truncate text-[14.5px] font-[480] tracking-[-0.01em]">{c.title}</p>
                </div>
                <span className="flex items-baseline gap-1">
                  <span className={`num font-mono text-[15px] ${c.score >= 75 ? "text-moss" : ""}`}>{c.score}</span>
                  <span className="label !text-[9px]">match</span>
                </span>
              </div>
              <p className="text-[11.5px] text-dim">{c.meta}</p>
              <div className="flex flex-wrap gap-1">
                {c.ok.map((o) => <span key={o} className="inline-flex h-5 items-center gap-1 rounded-full bg-moss-soft px-2 text-[10.5px] text-moss"><Check size={9} strokeWidth={2.6} />{o}</span>)}
                {c.miss.map((o) => <span key={o} className="inline-flex h-5 items-center gap-1 rounded-full bg-[rgb(var(--ink)/.06)] px-2 text-[10.5px] text-muted"><AlertTriangle size={9} className="text-amber" />{o}</span>)}
              </div>
            </div>
            {i === 0 && <Lock />}
          </DeckCard>
        ))}
      </div>
      <style>{`
        @keyframes hero-in { from { opacity: 0; filter: blur(10px); } to { opacity: 1; filter: none; } }
        .hero-card { animation: hero-in 1100ms cubic-bezier(.32,.72,0,1) both; }
        @keyframes lock { from { opacity: 0; transform: scale(1.18); } 60% { opacity: 1; } to { opacity: 1; transform: none; } }
        .hero-lock { animation: lock 900ms cubic-bezier(.32,.72,0,1) 1500ms both; }
        @media (prefers-reduced-motion: reduce) { .hero-card, .hero-lock { animation: none; } }
      `}</style>
    </div>
  );
}

/** The hero moment: four gold brackets close in on the best match once the deck has landed. */
function Lock() {
  const corner = "absolute size-6 border-accent";
  return (
    <div aria-hidden className="hero-lock pointer-events-none absolute -inset-3">
      <span className={`${corner} left-0 top-0 border-l border-t`} />
      <span className={`${corner} right-0 top-0 border-r border-t`} />
      <span className={`${corner} bottom-0 left-0 border-b border-l`} />
      <span className={`${corner} bottom-0 right-0 border-b border-r`} />
      <span className="label absolute -top-5 left-0 !text-[9.5px] !text-accent">Target locked</span>
    </div>
  );
}

function DeckCard({ i, spread, children }: { i: number; spread: MotionValue<number> | null; children: React.ReactNode }) {
  const transform = useTransform(spread ?? STATIC_ZERO, (v: number) => {
    const gap = 104 + v * 70;
    const depth = 90 + v * 110;
    return `translate3d(-50%, calc(-50% + ${(i - 1) * gap}px), ${(1 - i) * depth}px) rotateZ(${(i - 1) * v * 2.2}deg)`;
  });
  return (
    <motion.div className="hero-card absolute left-1/2 top-1/2 w-[86%]" style={{ transform, animationDelay: `${300 + i * 140}ms` }}>
      {children}
    </motion.div>
  );
}
