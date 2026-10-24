import { describe, expect, it } from "vitest";
import { staffReason, EXCLUSION_RULES, evaluateExclusion, exclusionColumn, exclusionRuleOf, excludedMessage, type ExclusionRule } from "./exclusions";

const excluded = (title: string, more: { description?: string; department?: string; category?: string; employer?: string } = {}) => evaluateExclusion({ title, ...more }).excluded;

describe("dining exclusions — Dining Commons jobs are excluded", () => {
  it.each([
    ["Dining Commons Student Assistant", {}],
    ["Student Assistant", { department: "Dining Commons" }],
    ["Student Worker", { employer: "Spartan Eats" }],
    ["Student Team Member", { department: "SJSU Dining Services", description: "Prepare food, wash dishes and keep the serving line stocked." }],
    ["Dining Hall Attendant", {}],
  ])("%s %j", (title, more) => {
    expect(excluded(title, more)).toBe(true);
  });
});

describe("dining exclusions — other dining-service work is excluded wherever it is posted", () => {
  it.each([
    "Line Cook", "Prep Cook", "Kitchen Assistant", "Dishwasher", "Barista", "Catering Attendant", "Catering Student Assistant",
    "Cafeteria Worker", "Food Service Worker", "Dining Cashier", "Food Cashier", "Food Delivery Driver", "Concessions Stand Worker",
    "Busser", "Food Runner", "Banquet Server", "Dining Service Attendant", "Deli Clerk", "Grill Cook",
  ])("%s", (title) => {
    const r = evaluateExclusion({ title, department: "Student Union" });
    expect(r.excluded).toBe(true);
    if (r.excluded) {
      expect(r.ruleId).toBe("dining");
      expect(r.reason).toMatch(/title names dining and food service work/);
    }
  });

  it("a generic title whose DUTIES are food service is excluded (two distinct duty phrases)", () => {
    const r = evaluateExclusion({ title: "Student Assistant", description: "Duties include food preparation, cooking for events and washing dishes. Must hold a food handler card." });
    expect(r).toMatchObject({ excluded: true, ruleId: "dining" });
    if (r.excluded) expect(r.evidence.length).toBeGreaterThanOrEqual(2);
  });

  it("matching ignores case, hyphens and extra spaces", () => {
    expect(excluded("LINE-COOK")).toBe(true);
    expect(excluded("dining   commons  assistant")).toBe(true);
  });
});

describe("legitimate office, desk and computer jobs stay eligible", () => {
  it.each([
    ["Front Desk Assistant", { department: "Student Wellness Center", description: "Greet visitors, answer phones, schedule appointments and do data entry." }],
    ["Office Assistant", { department: "College of Engineering" }],
    ["Library Student Assistant", { department: "King Library", description: "Check out materials at the circulation desk." }],
    ["IT Help Desk Student Assistant", { description: "Troubleshoot computer issues and answer tickets." }],
    ["Computer Lab Assistant", {}],
    ["Administrative Assistant", { description: "File records, answer email and coordinate catering orders for department events." }],
    ["Event Check-in Assistant", { department: "Student Union" }],
    ["Research Assistant", { department: "Nutrition, Food Science and Packaging" }],
    ["Data Entry Clerk", {}],
    ["Software Engineering Intern", { description: "Build services for a food delivery app." }],
  ])("%s %j", (title, more) => {
    expect(excluded(title, more)).toBe(false);
  });

  it("an administrative position is NOT excluded just because a dining office posted it", () => {
    expect(excluded("Administrative Assistant", { department: "Dining Services", description: "Answer phones, manage the office calendar, process invoices in Excel." })).toBe(false);
    expect(excluded("Dining Services Office Assistant", { description: "Front office support: phones, email, scheduling, filing." })).toBe(false);
    expect(excluded("Marketing Assistant", { employer: "Spartan Eats", description: "Design social media posts and flyers." })).toBe(false);
  });

  it("…but an office title whose duties are clearly food service is excluded", () => {
    expect(excluded("Office Assistant", { description: "Help in the kitchen: food preparation, cooking, washing dishes and serving meals." })).toBe(true);
  });

  it("does not fire on words that merely contain a dining term", () => {
    expect(excluded("Delivery Systems Analyst")).toBe(false); // "deli" inside "delivery"
    expect(excluded("Cookies and Privacy Compliance Assistant")).toBe(false); // "cook" inside "cookies"
    expect(excluded("Server Administrator", { description: "Maintain Linux servers." })).toBe(false); // IT servers are not food servers
  });
});

describe("the rule list is configurable and its result is auditable", () => {
  it("exclusionColumn stores the rule id and the reason; exclusionRuleOf reads the id back", () => {
    const col = exclusionColumn({ title: "Barista" });
    expect(col).toMatch(/^dining: /);
    expect(exclusionRuleOf(col)).toBe("dining");
    expect(exclusionColumn({ title: "Office Assistant" })).toBeNull();
    expect(excludedMessage(col!)).toMatch(/does not tailor resumes or prepare applications/);
    expect(excludedMessage(col!)).not.toMatch(/^.*dining: /);
  });

  it("a custom rule list is honoured, and the default list is untouched", () => {
    const custom: ExclusionRule[] = [{ id: "custodial", label: "Custodial work", workTitles: ["custodian", "janitor"], orgTerms: ["facilities services"], duties: ["mopping", "trash removal"] }];
    expect(evaluateExclusion({ title: "Night Custodian" }, custom)).toMatchObject({ excluded: true, ruleId: "custodial" });
    expect(evaluateExclusion({ title: "Barista" }, custom).excluded).toBe(false);
    expect(EXCLUSION_RULES.map((r) => r.id)).toEqual(["dining"]);
  });
});

describe("staff positions on campus feeds are not student jobs", () => {
  it("real Student Union staff titles (2026-10-22) and annual salaries are excluded with a reason", () => {
    expect(staffReason("Assistant Director, Student Union Programming", "year")).toMatch(/^staff: .*“Director”/);
    expect(staffReason("Manager of Outdoor Recreation and Rental Center", "year")).toMatch(/^staff: /);
    expect(staffReason("Program Coordinator", "year")).toMatch(/annual salary/);
  });
  it("student jobs stay, including ones with 'assistant', 'coordinator' or 'student manager' in the title", () => {
    expect(staffReason("Climbing Wall Assistant", "hour")).toBeNull();
    expect(staffReason("Club Sports Coordinator", "hour")).toBeNull();
    expect(staffReason("Student Manager, Information Desk", "hour")).toBeNull();
    expect(staffReason("Office Assistant", null)).toBeNull();
  });
});
