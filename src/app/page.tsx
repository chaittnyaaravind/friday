import { ArrowUpRight } from "lucide-react";
import { HeroStack } from "@/components/hero-stack";
import { Reveal, ScrollFade, ScrollProgress, Stagger, WordReveal } from "@/components/motion";
import { Card, Label, LinkButton } from "@/components/ui";
import { REGISTRY } from "@/lib/discovery/registry";
import { getUser } from "@/lib/supabase/server";

const PIPELINE = ["Discover", "Filter", "Deduplicate", "Verify", "Match", "Analyze", "Tailor", "Prepare", "You review", "You approve", "Track", "Follow up", "Interview", "Offer"];
const SJSU_FEEDS = REGISTRY.filter((c) => c.isSjsu).length;

export default async function Landing() {
  const user = await getUser();
  const cta = user ? { href: "/dashboard", label: "Open FRIDAY" } : { href: "/login", label: "Get started" };

  return (
    <div className="relative overflow-x-clip">
      <ScrollProgress />
      {/* viewport-edge glow — frames the hero like a lens */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 [background:radial-gradient(120%_80%_at_0%_100%,rgb(220_80_0/.16),transparent_45%),radial-gradient(90%_70%_at_100%_0%,rgb(143_165_107/.10),transparent_50%)]" />

      <header className="relative z-10 mx-auto flex max-w-[1240px] items-center justify-between px-5 py-5 md:px-10 md:py-7">
        <span className="text-[17px] font-medium tracking-[0.16em]">FRIDAY</span>
        <nav className="flex items-center gap-1">
          <a href="#how" className="hidden h-9 items-center rounded-full px-4 text-[13px] text-muted hover:text-text sm:inline-flex">How it works</a>
          <LinkButton href={cta.href} size="sm" variant="quiet">{user ? "Dashboard" : "Sign in"}</LinkButton>
        </nav>
      </header>

      <section className="relative z-10 mx-auto grid max-w-[1240px] items-center gap-12 px-5 pb-20 pt-8 md:grid-cols-[1.05fr_1fr] md:px-10 md:pb-28 md:pt-16">
        <ScrollFade className="reveal flex flex-col gap-7">
          <Label>For San José State students</Label>
          <h1 className="text-[52px] font-[450] leading-[0.94] tracking-[-0.045em] md:text-[88px]">
            Your career
            <br />
            <span className="serif-em text-[1.06em]">agent</span>, not
            <br />
            a job board.
          </h1>
          <p className="max-w-[44ch] text-[17px] leading-relaxed text-muted">
            FRIDAY checks {SJSU_FEEDS} official SJSU hiring pages every minute, ranks each on-campus opening against you, tailors your resume to it and tells you on Telegram. You approve; FRIDAY hands you the tailored resume and the application link.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <LinkButton href={cta.href} variant="primary" size="lg">{cta.label}</LinkButton>
            <a href="#how" className="inline-flex h-12 items-center gap-1.5 px-2 text-[14px] text-muted hover:text-text">See how it works <ArrowUpRight size={15} /></a>
          </div>
        </ScrollFade>
        <div className="reveal reveal-2">
          <HeroStack />
          <p className="label mt-2 text-center !text-[9.5px]">Preview · real listings found by FRIDAY</p>
        </div>
      </section>

      <div id="how" className="relative z-10 mx-auto max-w-[1240px] px-5 md:px-10">
        <WordReveal
          kicker="What FRIDAY does"
          text="FRIDAY finds the jobs, checks every source, explains each match, and prepares your application. You review. You approve."
          highlight={["review", "approve"]}
        />
      </div>

      <section className="relative z-10 mx-auto max-w-[1240px] px-5 pb-24 md:px-10">
        <Reveal>
        <div className="rule-dashed mb-10" />
        <Label>The agent loop</Label>
        <ol className="mt-5 flex flex-wrap gap-x-2 gap-y-3 text-[15px] md:text-[18px]">
          {PIPELINE.map((p, i) => (
            <li key={p} className="flex items-center gap-2">
              <span className={i >= 8 && i <= 9 ? "text-accent" : "text-text"}>{p}</span>
              {i < PIPELINE.length - 1 && <span className="text-dim">→</span>}
            </li>
          ))}
        </ol>
        <p className="mt-4 max-w-[60ch] text-[13.5px] text-muted">The two steps in orange are always yours. FRIDAY never sends anything you haven’t approved, never signs in anywhere as you, and never solves a CAPTCHA.</p>
        </Reveal>

        <Stagger className="mt-16 grid gap-3 md:grid-cols-3" gap={0.09}>
          {[
            ["01", "SJSU first", "On-campus jobs from official SJSU pages — Library, Associated Students, Peer Connections and more — plus one-step import from Handshake."],
            ["02", "Straight from the source", "Read from each office's own hiring page or job board, checked every minute: the real application link, pay and duties, never a reposted copy."],
            ["03", "No mystery scores", "Every match shows what lines up, what's missing, and how hard it is — with a concrete way to close each gap. Resume tailoring never invents experience."],
          ].map(([n, t, b]) => (
            <Card key={t} className="flex flex-col gap-4 p-6">
              <span className="num font-mono text-[12px] text-accent">{n}</span>
              <h3 className="text-[22px] leading-tight">{t}</h3>
              <p className="text-[14px] leading-relaxed text-muted">{b}</p>
            </Card>
          ))}
        </Stagger>

        <Reveal className="mt-24 flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
          <h2 className="max-w-[18ch] text-[36px] leading-[1] md:text-[52px]">
            Stop checking <span className="serif-em">twenty</span> sites every day.
          </h2>
          <LinkButton href={cta.href} variant="primary" size="lg">{cta.label}</LinkButton>
        </Reveal>
      </section>

      <footer className="relative z-10 mx-auto flex max-w-[1240px] flex-col justify-between gap-2 px-5 pb-8 text-[11.5px] text-dim md:flex-row md:px-10">
        <span>An independent student tool. Not affiliated with or endorsed by San José State University.</span>
        <span>Work-authorization notes are informational only — verify with SJSU ISSS.</span>
      </footer>
    </div>
  );
}
