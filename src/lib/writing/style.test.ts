import { describe, expect, it } from "vitest";
import { hasBlockingIssue, lintWriting, STYLE_GUIDE, styleFor } from "./style";

const codes = (t: string, kind: Parameters<typeof lintWriting>[1], ev = "") => lintWriting(t, kind, ev).map((i) => i.code);

describe("lintWriting — professional, credible, not generic", () => {
  it("flags stock openings, claimed passion and inflated self-description", () => {
    const t = "I am writing to express my interest in the Front Desk Assistant role. I am passionate about helping people and I am a results-driven team player.";
    expect(lintWriting(t, "cover_letter").filter((i) => i.code === "cliche").length).toBeGreaterThanOrEqual(3);
  });

  it("a scope upgrade the facts do not support is an ERROR; the same word backed by the facts is fine", () => {
    expect(hasBlockingIssue(lintWriting("Led a team of tutors at the Writing Center.", "bullet", "Tutored students at the Writing Center"))).toBe(true);
    expect(hasBlockingIssue(lintWriting("Led weekly study sessions for 12 students.", "bullet", "Led weekly study sessions for 12 students"))).toBe(false);
  });

  it("flags repetitive openings, keyword stuffing, first person in bullets, and over-length text", () => {
    expect(codes("Helped students.\nHelped staff.\nHelped visitors.", "bullet")).toContain("repetitive");
    expect(codes("Office support for office staff in the office: office filing, office phones, office email.", "summary")).toContain("stuffing");
    expect(codes("I answered phones at the front desk.", "bullet")).toContain("first_person");
    expect(codes(Array(40).fill("word").join(" "), "bullet")).toContain("length");
  });

  it("clean, specific writing passes with no issues", () => {
    const t = "Answered phone and walk-in questions at the Student Union information desk. Scheduled room bookings in Google Sheets and kept the visitor log current.";
    expect(lintWriting(t, "answer")).toEqual([]);
  });

  it("every prompt kind carries the shared guide, which forbids invented facts", () => {
    for (const k of ["summary", "skills", "bullet", "project", "cover_letter", "answer"] as const) expect(styleFor(k)).toContain(STYLE_GUIDE);
    expect(STYLE_GUIDE).toMatch(/Never invent numbers/);
    expect(STYLE_GUIDE).not.toMatch(/typo|detector|undetectable/i);
  });

  it("an empty draft is an error", () => {
    expect(hasBlockingIssue(lintWriting("   ", "answer"))).toBe(true);
  });
});

describe("AI-tell checks (humanizer / anti-slop)", () => {
  it("flags a tacked-on -ing clause at the end of a bullet, not a plain one", () => {
    // Live AI rewrite, 2026-10-25.
    expect(lintWriting("Built a connection diagnostics panel and Playwright test to force TURN relay, troubleshooting transfers that fail on restrictive networks", "bullet").map((i) => i.code)).toContain("ai_tell");
    expect(lintWriting("Added a diagnostics panel to troubleshoot transfers that fail on restrictive networks", "bullet")).toEqual([]);
    expect(lintWriting("Answered phones and emails at the front desk, including during finals week", "bullet").map((i) => i.code)).not.toContain("ai_tell");
    expect(lintWriting("Tested the app with over 1,100 automated Vitest tests, plus type checks, linting and a production build before each release", "bullet")).toEqual([]);
  });
  const codes = (t: string, k: Parameters<typeof lintWriting>[1] = "bullet") => lintWriting(t, k).map((i) => i.code);
  it("flags AI vocabulary, not-X-but-Y, padding riders, stock openers, dashes and duty phrasing", () => {
    expect(codes("Utilized Excel to track inventory")).toContain("ai_tell");
    expect(codes("Not just a front desk role, it's the face of the office", "answer")).toContain("ai_tell");
    expect(codes("Answered phone calls for the office, ensuring smooth operations")).toContain("ai_tell");
    expect(codes("I answered phones. Additionally, I filed records.", "answer")).toContain("ai_tell");
    expect(codes("Answered phones — and filed records")).toContain("dash");
    expect(codes("Responsible for answering phones")).toContain("duty");
  });
  it("leaves plain, specific writing alone (and date ranges are not 'dashes')", () => {
    expect(codes("Answered student questions at the library front desk and checked out laptops")).toEqual([]);
    expect(codes("Front desk assistant, 2024 – 2025", "answer")).not.toContain("dash");
  });
});
