import { describe, expect, it } from "vitest";
import { huntCard, type HuntCard } from "./message";

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
