import { ArrowUpRight } from "lucide-react";
import { HeroStack } from "@/components/hero-stack";
import { Reveal, ScrollFade, ScrollProgress, Stagger, WordReveal } from "@/components/motion";
import { Card, Label, LinkButton } from "@/components/ui";
import { REGISTRY } from "@/lib/discovery/registry";
import { getUser } from "@/lib/supabase/server";

const HUNT = ["Scout", "Track", "Verify", "Rank", "Tailor", "Alert", "You review", "You approve", "Apply", "Follow up", "Interview", "Offer"];
const YOURS = new Set(["You review", "You approve"]);
const SJSU_FEEDS = REGISTRY.filter((c) => c.isSjsu).length;

export default async function Landing() {
  const user = await getUser();
  const cta = user ? { href: "/dashboard", label: "Open FRIDAY" } : { href: "/login", label: "Start the hunt" };

  return (
    <div className="relative overflow-x-clip">
      <ScrollProgress />
      {/* viewport-edge glow — lamplight from the lower left, canopy from the upper right */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 [background:radial-gradient(120%_80%_at_0%_100%,rgb(217_164_65/.13),transparent_45%),radial-gradient(90%_70%_at_100%_0%,rgb(147_168_106/.09),transparent_50%)]" />

      <header className="relative z-10 mx-auto flex max-w-[1240px] items-center justify-between px-5 py-5 md:px-10 md:py-7">
        <span className="flex items-baseline gap-2.5">
          <span className="text-[17px] font-medium tracking-[0.16em]">FRIDAY</span>
          <span className="label hidden !text-[9.5px] sm:inline">the job hunter</span>
        </span>
        <nav className="flex items-center gap-1">
          <a href="#hunt" className="hidden h-9 items-center rounded-full px-4 text-[13px] text-muted hover:text-text sm:inline-flex">How it hunts</a>
          <LinkButton href={cta.href} size="sm" variant="quiet">{user ? "Dashboard" : "Sign in"}</LinkButton>
        </nav>
      </header>

      <section className="relative z-10 mx-auto grid max-w-[1240px] items-center gap-12 px-5 pb-20 pt-8 md:grid-cols-[1.05fr_1fr] md:px-10 md:pb-28 md:pt-16">
        <ScrollFade className="reveal flex flex-col gap-7">
          <Label>For San José State students</Label>
          <h1 className="text-[52px] font-[450] leading-[0.94] tracking-[-0.045em] md:text-[88px]">
            Every SJSU
            <br />
            job, <span className="serif-em text-[1.06em]">hunted</span>
            <br />
            for you.
          </h1>
          <p className="max-w-[44ch] text-[17px] leading-relaxed text-muted">
            FRIDAY tracks {SJSU_FEEDS} official SJSU hiring pages every minute. When a campus job opens, it ranks the job against you, tailors your resume to it and finds you on Telegram. You approve; FRIDAY hands you the resume and the real application link.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <LinkButton href={cta.href} variant="primary" size="lg">{cta.label}</LinkButton>
            <a href="#hunt" className="inline-flex h-12 items-center gap-1.5 px-2 text-[14px] text-muted hover:text-text">See how it hunts <ArrowUpRight size={15} /></a>
          </div>
        </ScrollFade>
        <div className="reveal reveal-2">
          <HeroStack />
          <p className="label mt-2 text-center !text-[9.5px]">Preview · real listings found by FRIDAY</p>
        </div>
      </section>

      <div id="hunt" className="relative z-10 mx-auto max-w-[1240px] px-5 md:px-10">
        <WordReveal
          kicker="How FRIDAY hunts"
          text="FRIDAY tracks the openings, checks every source, reads each job against you, and readies your application. You review. You approve."
          highlight={["review", "approve"]}
        />
      </div>

      <section className="relative z-10 mx-auto max-w-[1240px] px-5 pb-24 md:px-10">
        <Reveal>
        <div className="rule-dashed mb-10" />
        <Label>The hunt</Label>
        <ol className="mt-5 flex flex-wrap gap-x-2 gap-y-3 text-[15px] md:text-[18px]">
          {HUNT.map((p, i) => (
            <li key={p} className="flex items-center gap-2">
              <span className={YOURS.has(p) ? "text-accent" : "text-text"}>{p}</span>
              {i < HUNT.length - 1 && <span className="text-dim">→</span>}
            </li>
          ))}
        </ol>
        <p className="mt-4 max-w-[60ch] text-[13.5px] text-muted">The two steps in gold are always yours. FRIDAY never sends anything you haven’t approved, never signs in anywhere as you, and never solves a CAPTCHA.</p>
        </Reveal>

        <Stagger className="mt-16 grid gap-3 md:grid-cols-3" gap={0.09}>
          {[
            ["01", "SJSU is the hunting ground", "On-campus jobs from official SJSU pages: Library, Associated Students, Peer Connections and more. Found one on Handshake? Paste it to FRIDAY on Telegram."],
            ["02", "Straight from the source", "Read from each office's own hiring page or job board, checked every minute: the real application link, pay and duties, never a reposted copy."],
            ["03", "No mystery scores", "Every match shows what lines up, what's missing, and how hard it is, with a concrete way to close each gap. Resume tailoring never invents experience."],
          ].map(([n, t, b]) => (
            <Card key={t} className="flex flex-col gap-4 p-6">
              <span className="num font-mono text-[12px] text-dim">{n}</span>
              <h3 className="text-[22px] leading-tight">{t}</h3>
              <p className="text-[14px] leading-relaxed text-muted">{b}</p>
            </Card>
          ))}
        </Stagger>

        <Reveal className="mt-24 flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
          <h2 className="max-w-[18ch] text-[36px] leading-[1] md:text-[52px]">
            Stop checking <span className="serif-em">twenty</span> sites. Let FRIDAY hunt.
          </h2>
          <LinkButton href={cta.href} variant="primary" size="lg">{cta.label}</LinkButton>
        </Reveal>
      </section>

      <footer className="relative z-10 mx-auto flex max-w-[1240px] flex-col justify-between gap-2 px-5 pb-8 text-[11.5px] text-dim md:flex-row md:px-10">
        <span>An independent student tool. Not affiliated with or endorsed by San José State University. No students were hunted, only jobs.</span>
        <span>Work-authorization notes are informational only — verify with SJSU ISSS.</span>
      </footer>
    </div>
  );
}
