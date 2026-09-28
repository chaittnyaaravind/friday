import { describe, expect, it } from "vitest";
import { parseHours } from "./hours";

// The first three strings are copied from the live SJSU Student Union feed (captured 2026-09-27).
const IN_SESSION = "When school is in session - may work up to, but not in excess of 20 hours per week (among all concurrent positions)";
const BREAK = "During breaks (winter, spring and summer break) may work up to, but not in excess of 40 hours per week";

describe("parseHours — reads only what the posting states", () => {
  it("REAL (Student Union): 'up to, but not in excess of 20 hours per week' in session", () => {
    expect(parseHours(IN_SESSION)).toEqual({ text: "Up to 20 hrs/week", min: null, max: 20, breakMax: null });
  });
  it("REAL (Student Union): the in-session cap and the break cap are told apart", () => {
    expect(parseHours(`${IN_SESSION}; ${BREAK}`)).toEqual({ text: "Up to 20 hrs/week (40 on breaks)", min: null, max: 20, breakMax: 40 });
  });
  it("REAL: the break cap alone is not mistaken for the term cap when the order is reversed", () => {
    expect(parseHours(`${BREAK}. ${IN_SESSION}`)).toMatchObject({ max: 20, breakMax: 40 });
  });
  it("REAL (Student Union, verbatim): 'When school is in session … 20 hours … When classes are not in session (i.e. summer break) … 40 hours'", () => {
    const real =
      "When school is in session - may work up to, but not in excess of 20 hours per week (among all concurrent positions). " +
      "When classes are not in session (i.e. summer break) may work up to, but not in excess of 40 hours per week. This position is non-exempt.";
    expect(parseHours(real)).toEqual({ text: "Up to 20 hrs/week (40 on breaks)", min: null, max: 20, breakMax: 40 });
  });
  it("'not in session' is never read as 'in session'", () => {
    expect(parseHours("When classes are not in session, up to 40 hours per week.")).toMatchObject({ max: 40, breakMax: null }); // a lone cap is the cap
    expect(parseHours("In session: up to 15 hours per week. Not in session: up to 30 hours per week.")).toMatchObject({ max: 15, breakMax: 30 });
  });
  it("ranges", () => {
    expect(parseHours("Hours are 10-20 hours per week.")).toEqual({ text: "10–20 hrs/week", min: 10, max: 20, breakMax: null });
    expect(parseHours("10 to 15 hrs a week")).toMatchObject({ min: 10, max: 15 });
    expect(parseHours("12–16 hours/week")).toMatchObject({ min: 12, max: 16 });
  });
  it("EXISTING BEHAVIOR: the formats the old parser handled give the same text", () => {
    expect(parseHours("Work 10–20 hours per week during the term")?.text).toBe("10–20 hrs/week");
    expect(parseHours("Up to 20 hours per week")?.text).toBe("Up to 20 hrs/week");
    expect(parseHours("maximum of 19 hrs/week")?.text).toBe("Up to 19 hrs/week");
  });
  it("other cap wordings", () => {
    for (const s of ["no more than 20 hours per week", "not to exceed 20 hours a week", "at most 20 hrs. per week", "limited to 20 hours each week", "max. 20 hours weekly"]) {
      expect(parseHours(s), s).toMatchObject({ max: 20 });
    }
  });
  it("a plain statement of weekly hours", () => {
    expect(parseHours("This position works 15 hours per week.")).toEqual({ text: "15 hrs/week", min: 15, max: 15, breakMax: null });
    expect(parseHours("20 hours weekly")).toMatchObject({ max: 20 });
  });
  it("finds hours inside a long description", () => {
    expect(parseHours(`Lots of text before. ${IN_SESSION}. More text after about duties and pay $20.50 an hour.`)?.max).toBe(20);
  });
  it("says nothing when the posting says nothing", () => {
    for (const s of ["", null, undefined, "Great job for a student", "Apply now for our $18 an hour role", "Pays weekly", "150 hours/semester", "20 hours"]) expect(parseHours(s as string), String(s)).toBeNull();
  });
  it("rejects figures that cannot be weekly hours", () => {
    expect(parseHours("up to 90 hours per week")).toBeNull();
    expect(parseHours("0 hours per week")).toBeNull();
  });
  it("a reversed or degenerate range is not a range", () => {
    expect(parseHours("20-10 hours per week")).not.toMatchObject({ min: 20, max: 10 });
    expect(parseHours("20-20 hours per week")).toMatchObject({ min: 20, max: 20 });
  });
});
