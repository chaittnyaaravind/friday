"use client";

import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useEffect, useState, useSyncExternalStore } from "react";

const LOCKABLE = "a, button, [data-lock]";
const SPRING = { stiffness: 520, damping: 40, mass: 0.5 };
const FREE = 26;

const finePointer = (cb: () => void) => {
  const mq = window.matchMedia("(pointer: fine)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

/**
 * The hunter's crosshair: follows a mouse or trackpad and, over a link or button, springs out to bracket it ("locked").
 * Touch screens and reduced motion keep the normal cursor and never mount it.
 */
export function HuntCursor() {
  const reduced = useReducedMotion();
  const fine = useSyncExternalStore(finePointer, () => window.matchMedia("(pointer: fine)").matches, () => false);
  if (!fine || reduced) return null;
  return <Crosshair />;
}

function Crosshair() {
  const [locked, setLocked] = useState(false);
  const [seen, setSeen] = useState(false);
  const x = useMotionValue(-100), y = useMotionValue(-100), w = useMotionValue(FREE), h = useMotionValue(FREE);
  const sx = useSpring(x, SPRING), sy = useSpring(y, SPRING), sw = useSpring(w, SPRING), sh = useSpring(h, SPRING);
  const ox = useTransform(sw, (v) => -v / 2), oy = useTransform(sh, (v) => -v / 2);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("hunt-cursor");
    let target: Element | null = null;
    let px = -100, py = -100;
    const aim = () => {
      if (target?.isConnected) {
        const r = target.getBoundingClientRect();
        x.set(r.left + r.width / 2); y.set(r.top + r.height / 2);
        w.set(r.width + 14); h.set(r.height + 12);
      } else {
        x.set(px); y.set(py); w.set(FREE); h.set(FREE);
      }
    };
    const move = (e: PointerEvent) => {
      px = e.clientX; py = e.clientY;
      target = (e.target as Element | null)?.closest?.(LOCKABLE) ?? null;
      setLocked(Boolean(target));
      setSeen(true);
      aim();
    };
    const leave = () => setSeen(false);
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("scroll", aim, { passive: true });
    document.addEventListener("pointerleave", leave);
    return () => {
      root.classList.remove("hunt-cursor");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("scroll", aim);
      document.removeEventListener("pointerleave", leave);
    };
  }, [x, y, w, h]);

  const corner = `absolute border-accent transition-[width,height] duration-150 ${locked ? "size-2.5" : "size-2"}`;
  return (
    <motion.div aria-hidden className="pointer-events-none fixed left-0 top-0 z-[70]" style={{ x: sx, y: sy, opacity: seen ? 1 : 0 }}>
      <motion.div className="absolute" style={{ width: sw, height: sh, x: ox, y: oy }}>
        <span className={`${corner} left-0 top-0 border-l border-t`} />
        <span className={`${corner} right-0 top-0 border-r border-t`} />
        <span className={`${corner} bottom-0 left-0 border-b border-l`} />
        <span className={`${corner} bottom-0 right-0 border-b border-r`} />
        <span className={`absolute left-1/2 top-1/2 size-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent transition-opacity duration-150 ${locked ? "opacity-0" : ""}`} />
      </motion.div>
    </motion.div>
  );
}
