import { describe, expect, it } from "vitest";
import { applyChannel, isSjsuEmail } from "./apply-channel";

describe("applyChannel — read from the posting's own instructions", () => {
  it("email-only applications to an sjsu.edu address can be sent by the Gmail bridge", () => {
    expect(applyChannel("Interested students should email their resume to Front.Desk@sjsu.edu by Friday.", null)).toEqual({ kind: "email", to: "front.desk@sjsu.edu" });
    expect(applyChannel("Questions? Call us.", "mailto:hiring@sjsu.edu")).toEqual({ kind: "email", to: "hiring@sjsu.edu" });
  });
  it("a posting that also wants a form is handed off, saying exactly why (real Parking Services wording)", () => {
    const c = applyChannel("If interested, please complete a SJSU Student Assistant Job Application [pdf] and email it to ngoc.nguyen@sjsu.edu.", null);
    expect(c.kind).toBe("site");
    if (c.kind === "site") expect(c.needs).toEqual(["the SJSU Student Assistant job application form"]);
  });
  it("addresses outside sjsu.edu are never used", () => {
    expect(applyChannel("Email your resume to jobs@gmail.com", null).kind).toBe("site");
  });
  it("no email instruction → the official page", () => {
    expect(applyChannel("Apply on Handshake.", "https://app.joinhandshake.com/jobs/1").kind).toBe("site");
  });
  it("isSjsuEmail is exact", () => {
    expect(isSjsuEmail("a.b@sjsu.edu")).toBe(true);
    expect(isSjsuEmail("a@sjsu.edu.evil.com")).toBe(false);
  });
});
