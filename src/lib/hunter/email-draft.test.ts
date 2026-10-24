import { describe, expect, it } from "vitest";
import { hasBlockingIssue, lintWriting } from "@/lib/writing/style";
import { applicationEmail } from "./email-draft";

const P = { fullName: "Sam Lee", university: "San José State University", major: "Computer Science", graduationYear: 2028, availability: "Mon/Wed 9am–1pm.", email: "sam@sjsu.edu" };

describe("applicationEmail", () => {
  it("uses only profile facts and passes FRIDAY's writing lint", () => {
    const m = applicationEmail(P, { title: "Office Assistant", employer: "SJSU Parking Services" }, null);
    expect(m.subject).toBe("Application: Office Assistant — Sam Lee");
    expect(m.body).toContain("Computer Science student at San José State University graduating in 2028");
    expect(m.body).toContain("My availability: Mon/Wed 9am–1pm.");
    expect(m.body).not.toContain("..");
    expect(hasBlockingIssue(lintWriting(m.body, "cover_letter"))).toBe(false);
  });
  it("leaves out what the profile does not say", () => {
    const m = applicationEmail({ ...P, major: null, university: null, graduationYear: null, availability: null }, { title: "Clerk", employer: "Library" }, null);
    expect(m.body).not.toMatch(/student|availability/i);
  });
  it("a cover letter the student wrote is the body", () => {
    expect(applicationEmail(P, { title: "Clerk", employer: "Library" }, "Dear team, …").body).toBe("Dear team, …");
  });
});
