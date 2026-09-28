import { describe, expect, it } from "vitest";
import { parsePay } from "./normalize";

describe("parsePay — real pay strings from SJSU's Student Union feed (2026-09-27)", () => {
  it.each([
    ["$20.50 - $23.25 / hour", "$20.50–$23.25/hr", 20.5, 23.25],
    ["$19.5 - $22.25 / hour", "$19.50–$22.25/hr", 19.5, 22.25],
    ["$23.5 - $35.5 / hour", "$23.50–$35.50/hr", 23.5, 35.5],
    ["$18.5 - $21.25 / hour", "$18.50–$21.25/hr", 18.5, 21.25],
  ])("%s → %s", (input, text, min, max) => {
    expect(parsePay(input)).toMatchObject({ text, min, max, unit: "hour" });
  });
});

describe("parsePay — units in the words postings actually use", () => {
  it.each([
    ["$18 an hour", "$18/hr", "hour"],
    ["$18.50 hourly", "$18.50/hr", "hour"],
    ["$18/hr.", "$18/hr", "hour"],
    ["Pays $17.45 per hour plus benefits", "$17.45/hr", "hour"],
    ["$500 per week", "$500/wk", "week"],
    ["$500 weekly", "$500/wk", "week"],
    ["$1,500 per semester", "$1,500/semester", "semester"],
    ["$9,500 per month", "$9,500/mo", "month"],
    ["$60,000 - $70,000 per year", "$60K–$70K/yr", "year"],
    ["$120K–$150K annually", "$120K–$150K/yr", "year"],
    ["$85,000 a year", "$85K/yr", "year"],
  ])("%s → %s", (input, text, unit) => {
    expect(parsePay(input)).toMatchObject({ text, unit });
  });
});

describe("parsePay — numbers are shown exactly, not rounded", () => {
  it("$9,500 is not $10K, and $1,250 is not $1K", () => {
    expect(parsePay("$8,000 - $9,500 / month")?.text).toBe("$8K–$9,500/mo");
    expect(parsePay("$1,250 per month")?.text).toBe("$1,250/mo");
  });
  it("round thousands still use K", () => {
    expect(parsePay("$8,000/month")?.text).toBe("$8K/mo");
  });
});

describe("parsePay — picking the right amount from a whole description", () => {
  it("prefers an amount with a stated unit over an earlier bare dollar figure", () => {
    expect(parsePay("Sign-on bonus $5000. Pay is $20/hr for students.")).toMatchObject({ text: "$20/hr", unit: "hour" });
  });
  it("ignores company figures such as '$5 million in funding'", () => {
    expect(parsePay("We raised $5 million in funding. The role pays $22 per hour.")).toMatchObject({ text: "$22/hr", unit: "hour" });
    expect(parsePay("Backed by $200 million in funding.")).toBeNull();
  });
  it("with only unit-less amounts, the first is used and its unit stays unknown", () => {
    expect(parsePay("Stipend $18 and a bonus of $500")).toMatchObject({ text: "$18/hr", unit: null });
  });
});

describe("parsePay — EXISTING BEHAVIOR", () => {
  it("the formats it always handled are unchanged", () => {
    expect(parsePay("$45 - $55 per hour")?.text).toBe("$45–$55/hr");
    expect(parsePay("$45 to $55 per hour")?.text).toBe("$45–$55/hr");
    expect(parsePay("$8,000/month")?.text).toBe("$8K/mo");
    expect(parsePay("$120K–$150K")?.text).toBe("$120K–$150K/yr");
  });
  it("with no unit stated it still guesses from the size, and says the unit is not known", () => {
    expect(parsePay("$18")).toMatchObject({ text: "$18/hr", unit: null });
    expect(parsePay("$1500")).toMatchObject({ text: "$1,500/mo", unit: null });
    expect(parsePay("$95000")).toMatchObject({ text: "$95K/yr", unit: null });
  });
  it("no pay in the text means no pay", () => {
    for (const s of ["no pay listed", "", null, undefined, "Pay: TBD", "Competitive salary"]) expect(parsePay(s as string), String(s)).toBeNull();
  });
});
