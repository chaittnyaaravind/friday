import { describe, expect, it } from "vitest";
import { CAMPUS_EMPLOYERS, CAMPUS_EMPLOYER_LABEL, CAMPUS_NOT_COVERED, CAMPUS_ROLES, CAMPUS_ROLE_LABEL, campusEmployerOf, classifyCampusRoles, isCampusEmployer, isCampusRole } from "./campus";

describe("classifyCampusRoles — real titles from SJSU's own pages and feeds", () => {
  // Titles below were seen live on 2026-09-27 (Associated Students page, MLK Library page, Student Union feed, Peer Connections page).
  it.each([
    ["Kitchen Assistant", ["dining_retail", "student_assistant"]],
    ["Office Assistant", ["front_desk_admin", "student_assistant"]],
    // The Associated Students "Counter Clerk" is at the Print Shop (live page, 2026-10-22): counter service, not dining.
    ["Counter Clerk", ["front_desk_admin"]],
    ["Parking Services Office Student Assistant", ["front_desk_admin", "student_assistant"]],
    ["IT Helpdesk Student Assistant", ["it_support", "student_assistant"]],
    ["LRSP - Student Engagement Research Assistant", ["research_assistant", "student_assistant"]],
    ["Club Sports Student Supervisor", ["fitness_recreation", "student_assistant"]],
    ["Student Photographer and Videographer", ["technical_media", "student_assistant"]],
    ["Fitness Instructor", ["fitness_recreation"]],
    ["EC Administrative Student Assistant", ["front_desk_admin", "student_assistant"]],
    ["Student Intramural Sports Official", ["fitness_recreation", "student_assistant"]],
    ["Learning Assistants", ["tutor_mentor", "student_assistant"]],
    ["Academic Peer Mentors", ["tutor_mentor"]],
    ["Peer Tutors", ["tutor_mentor"]],
    ["Supplemental Instruction (SI) Leaders", ["tutor_mentor"]],
  ])("%s → %j", (title, roles) => {
    expect(classifyCampusRoles(title)).toEqual(roles);
  });

  it("the roles a student searches for by name", () => {
    expect(classifyCampusRoles("Lab Assistant")).toEqual(["lab_assistant", "student_assistant"]);
    expect(classifyCampusRoles("Research Assistant, Biology")).toContain("research_assistant");
    expect(classifyCampusRoles("Teaching Assistant, Computer Science")).toEqual(["teaching_assistant", "student_assistant"]);
    expect(classifyCampusRoles("Resident Advisor")).toEqual(["resident_advisor"]);
    expect(classifyCampusRoles("Orientation & Transition Leader")).toEqual(["orientation_leader"]);
    expect(classifyCampusRoles("Student Assistant")).toEqual(["student_assistant"]);
  });

  it("'RA' alone is never guessed to mean resident advisor (it is just as often research assistant)", () => {
    expect(classifyCampusRoles("RA")).toEqual(["other"]);
  });
  it("'TA' is a teaching assistant only as a capitalised word, not inside other words", () => {
    expect(classifyCampusRoles("TA for CS 46A")).toContain("teaching_assistant");
    expect(classifyCampusRoles("Data entry")).not.toContain("teaching_assistant");
  });
  it("anything it does not recognise is 'other' — never a made-up role", () => {
    for (const t of ["Accounting Manager", "Head Teacher, Preschool", "", null, undefined]) expect(classifyCampusRoles(t as string), String(t)).toEqual(["other"]);
  });
  it("'other' never appears together with a real role, and the generic role is always last", () => {
    for (const t of ["Kitchen Assistant", "IT Helpdesk Student Assistant", "Lab Assistant", "Learning Assistants", "Accounting Manager"]) {
      const r = classifyCampusRoles(t);
      if (r.includes("other")) expect(r).toEqual(["other"]);
      if (r.includes("student_assistant")) expect(r.at(-1)).toBe("student_assistant");
    }
  });
  it("every role has a label and is recognised by the guard", () => {
    for (const r of CAMPUS_ROLES) {
      expect(CAMPUS_ROLE_LABEL[r]).toBeTruthy();
      expect(isCampusRole(r)).toBe(true);
    }
    expect(isCampusRole("astronaut")).toBe(false);
  });
});

describe("campusEmployerOf — from the source, never guessed", () => {
  it("maps each registered SJSU source to its employer", () => {
    expect(campusEmployerOf("sjsu-library")).toBe("library");
    expect(campusEmployerOf("sjsu-associated-students")).toBe("associated_students");
    expect(campusEmployerOf("sjsu-peer-connections")).toBe("peer_connections");
    expect(campusEmployerOf("sjsu-student-union")).toBe("student_union");
    expect(campusEmployerOf("sjsu-research-foundation")).toBe("research_foundation");
    expect(campusEmployerOf("sjsu-writing-center")).toBe("writing_center");
    expect(campusEmployerOf("sjsu-orientation-leaders")).toBe("orientation");
  });
  it("another SJSU source is 'department'; a non-SJSU or missing one is 'other'", () => {
    expect(campusEmployerOf("sjsu-some-department")).toBe("department");
    expect(campusEmployerOf("imp-1234abcd-sjsu-handshake")).toBe("other");
    expect(campusEmployerOf("nvidia")).toBe("other");
    expect(campusEmployerOf(null)).toBe("other");
    expect(campusEmployerOf(undefined)).toBe("other");
  });
  it("every employer has a label and is recognised by the guard", () => {
    for (const e of CAMPUS_EMPLOYERS) {
      expect(CAMPUS_EMPLOYER_LABEL[e]).toBeTruthy();
      expect(isCampusEmployer(e)).toBe(true);
    }
    expect(isCampusEmployer("mars")).toBe(false);
  });
});

describe("employers FRIDAY does not cover are stated, with a reason and a date", () => {
  it("each has a reason, a URL and the date it was checked", () => {
    // Spartan Eats is not listed: dining work is excluded on purpose (exclusions.ts), it is not a gap in coverage.
    expect(CAMPUS_NOT_COVERED.map((c) => c.name)).toEqual(["University Housing (Resident Advisors)", "Spartan Bookstore"]);
    for (const c of CAMPUS_NOT_COVERED) {
      expect(c.reason.length).toBeGreaterThan(20);
      expect(c.url).toMatch(/^https?:\/\//);
      expect(c.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(c.reason).not.toMatch(/no jobs|not hiring/i); // a gap in coverage is never presented as an absence of jobs
    }
  });
});
