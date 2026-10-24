import { describe, expect, it } from "vitest";
import { huntCard, type HuntCard, openJobsNotice } from "./message";

const base: HuntCard = {
  itemId: "11111111-1111-1111-1111-111111111111",
  job: { title: "Front Desk <Assistant>", employer: "SJSU Parking Services", payText: "$18 per hour", physical: "moderate", physicalWhy: ["walking in parking garages (may be required)"], deskWhy: ["reception", "data entry"], source: "Official SJSU page", url: "https://www.sjsu.edu/parking", deadline: null },
  score: 82,
  research: { summary: "Front desk support for permits.", required: ["Customer service"] },
  resume: { label: "Resume — Parking", matched: 3, total: 4, missing: ["Spanish"], changes: ["Skills reordered"], verified: true },
  channel: { kind: "email", to: "x@sjsu.edu" },
  email: { to: "x@sjsu.edu", subject: "Application: Front Desk Assistant", body: "Hello," },
  confirmations: ["eligibility_verify"],
  blockers: [],
  appUrl: "https://friday.example/applications/1",
};

describe("huntCard", () => {
  it("escapes posting text and shows exactly what Approve does", () => {
    const m = huntCard(base);
    expect(m.text).toContain("Front Desk &lt;Assistant&gt;");
    expect(m.text).toContain("send this from your Gmail");
    expect(m.text).toContain("Approving also confirms");
    expect(m.buttons[0][0]).toEqual({ text: "✅ Approve & send", data: `ap:${base.itemId}` });
    // Telegram callback_data is limited to 64 bytes.
    expect(new TextEncoder().encode(m.buttons[0][0].data!).length).toBeLessThanOrEqual(64);
  });
  it("a blocked packet has no Approve button and says why", () => {
    const m = huntCard({ ...base, blockers: ["This listing is closed."] });
    expect(m.text).toContain("Can't approve yet");
    expect(m.buttons.flat().some((b) => b.data?.startsWith("ap:"))).toBe(false);
  });
  it("hand-off jobs say the student submits", () => {
    const m = huntCard({ ...base, channel: { kind: "site", reason: "Apply on Handshake.", needs: [] }, email: null });
    expect(m.text).toContain("you submit there");
    expect(m.buttons[0][0].text).toBe("✅ Approve");
  });
  it("stays under Telegram's limit", () => {
    expect(huntCard({ ...base, research: { summary: "x".repeat(10_000), required: [] }, email: { ...base.email!, body: "y".repeat(10_000) } }).text.length).toBeLessThanOrEqual(4000);
  });
});

describe("openJobsNotice (/open)", () => {
  it("states the counted totals, per employer, and links each desk job; titles are HTML-escaped", () => {
    const m = openJobsNotice(
      { open: 3, desk: 1, byEmployer: [{ company: "SJSU King Library", open: 2, desk: 1 }, { company: "SJSU Student Union", open: 1, desk: 0 }] },
      [
        { id: "j1", title: "IT Helpdesk <Student> Assistant", company: "SJSU King Library", deadline: null, desk: true },
        { id: "j2", title: "Video Production", company: "SJSU King Library", deadline: null, desk: false },
      ],
      "https://friday.example",
    );
    expect(m.text).toContain("3 SJSU jobs open to apply now</b> · 1 desk");
    expect(m.text).toContain("King Library 2 (1 desk) · Student Union 1");
    expect(m.text).toContain('href="https://friday.example/jobs/j1"');
    expect(m.text).toContain("IT Helpdesk &lt;Student&gt; Assistant");
    expect(m.text).not.toContain("Video Production"); // only desk jobs are listed
    expect(m.buttons[0][0].url).toBe("https://friday.example/sjsu");
  });
});

describe("huntCard shows the AI rewrites and the posting's screens", () => {
  it("counts rewrites with one example, and marks each screen", async () => {
    const base = (await import("./message")).huntCard;
    const card = base({
      itemId: "00000000-0000-4000-8000-000000000001",
      job: { title: "Office Assistant", employer: "SJSU Associated Students", payText: null, physical: "low", physicalWhy: [], deskWhy: ["computer work"], source: "Official page", url: null, deadline: null },
      score: 80, research: null,
      resume: { label: "Resume — AS", matched: 2, total: 3, missing: [], changes: [], verified: true, rewrites: [{ where: "Experience · Front Desk", after: "Greeted visitors & answered questions" }] },
      screens: [{ label: "Customer-facing experience", covered: "yes" }, { label: "Excel", covered: "no" }, { label: "Availability", covered: "check" }],
      channel: { kind: "site", reason: "Apply on the official page.", needs: [] }, email: null, confirmations: [], blockers: [], appUrl: "https://x/app",
    });
    expect(card.text).toContain("1 line rewritten in the posting's terms");
    expect(card.text).toContain("Greeted visitors &amp; answered questions");
    expect(card.text).toContain("✅ Customer-facing experience · ❌ Excel · ❔ Availability");
  });
});
