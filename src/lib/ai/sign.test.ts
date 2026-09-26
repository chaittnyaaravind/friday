import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applySuggestion, type Target } from "@/lib/resume/edits";
import type { ResumeDoc } from "@/lib/resume/types";

vi.mock("server-only", () => ({}));
// @/lib/api pulls in the Supabase server client; the check only needs its error class.
vi.mock("@/lib/api", () => ({ HttpError: class HttpError extends Error { constructor(public status: number, message: string) { super(message); } } }));
const sign = await import("./sign");

const line = (id: string, text: string) => ({ id, text, origin: "user" as const, sourceItemId: null });
const doc = (bullet = "Built React application."): ResumeDoc => ({
  version: 1,
  header: { name: "Sample Student", contact: ["sample@example.com"], origin: "user" },
  sections: [
    { id: "exp", kind: "experience", title: "Experience", lines: [], entries: [{ id: "e1", sourceItemId: null, heading: "Intern", subheading: "", meta: "2025", origin: "user", bullets: [line("b1", bullet)] }] },
    { id: "skl", kind: "skills", title: "Skills", entries: [], lines: [line("s1", "Languages: Python, SQL")] },
  ],
});
const target: Target = { kind: "line", sectionId: "exp", entryId: "e1", lineId: "b1" };
const ENV = ["AI_SIGNING_SECRET", "SUPABASE_SECRET_KEY"];
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; } process.env.AI_SIGNING_SECRET = "test-secret-0123456789abcdef"; });
afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";

describe("server-signed AI text", () => {
  it("a signature verifies only for the same user, text and basis", () => {
    const sig = sign.signAiText(U1, "Developed a React application.", "Built React application.");
    expect(sign.verifyAiText(U1, "Developed a React application.", "Built React application.", sig)).toBe(true);
    expect(sign.verifyAiText(U2, "Developed a React application.", "Built React application.", sig)).toBe(false); // another user's signature
    expect(sign.verifyAiText(U1, "Developed a React application used by 50,000 users.", "Built React application.", sig)).toBe(false); // text changed
    expect(sign.verifyAiText(U1, "Developed a React application.", "Built React application. used by 50,000 users", sig)).toBe(false); // basis forged
    expect(sign.verifyAiText(U1, "Developed a React application.", "Built React application.", sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0"))).toBe(false);
    expect(sign.verifyAiText(U1, "x", "y", undefined)).toBe(false);
  });

  it("without a signing secret nothing verifies and signing refuses (no silent unsigned AI text)", () => {
    delete process.env.AI_SIGNING_SECRET;
    expect(sign.signingAvailable()).toBe(false);
    expect(() => sign.signAiText(U1, "a", "b")).toThrow();
    expect(sign.verifyAiText(U1, "a", "b", "0".repeat(32))).toBe(false);
  });

  it("falls back to the Supabase secret key when no dedicated secret is set", () => {
    delete process.env.AI_SIGNING_SECRET;
    process.env.SUPABASE_SECRET_KEY = "sb_secret_0123456789abcdef";
    expect(sign.signingAvailable()).toBe(true);
  });
});

describe("assertAiLinesSigned — a malicious client cannot label its own text as verified AI output", () => {
  const signed = (userId: string) => {
    const basis = "Built React application.";
    const text = "Developed a React application.";
    return applySuggestion(doc(), target, text, { op: "improve", basis, sig: sign.signAiText(userId, text, basis) });
  };

  it("accepts a line the server signed for this user", () => {
    expect(() => sign.assertAiLinesSigned(signed(U1), U1, doc())).not.toThrow();
  });

  it("REJECTS the forged-basis attack: an AI-labelled line whose 'basis' contains the invented claims", () => {
    const evil = "Built REST API endpoints, used by 50,000 students and deployed across AWS and Kubernetes";
    const forged = applySuggestion(doc(), target, evil, { op: "improve", basis: evil }); // no signature possible
    expect(() => sign.assertAiLinesSigned(forged, U1, doc())).toThrowError(/labelled AI-written but weren't produced by FRIDAY/);
    try { sign.assertAiLinesSigned(forged, U1, doc()); } catch (e) { expect((e as { status: number }).status).toBe(422); }
  });

  it("REJECTS a made-up signature, a signature copied from another user, and signed text edited afterwards", () => {
    const evil = "Built REST API, used by 50,000 students";
    const made = applySuggestion(doc(), target, evil, { op: "improve", basis: evil, sig: "0".repeat(32) });
    expect(() => sign.assertAiLinesSigned(made, U1, doc())).toThrow();
    expect(() => sign.assertAiLinesSigned(signed(U2), U1, doc())).toThrow(); // signed for someone else
    const edited = signed(U1);
    edited.sections[0].entries[0].bullets[0].text += " and deployed on AWS"; // tampered after signing
    expect(() => sign.assertAiLinesSigned(edited, U1, doc())).toThrow();
  });

  it("text the user wrote, edited or attested to (origin user) needs no signature", () => {
    const userText = applySuggestion(doc(), target, "Built React application used by 5,000 students.", { op: "improve", basis: "", userEdited: true });
    expect(userText.sections[0].entries[0].bullets[0]).toMatchObject({ origin: "user" });
    expect(() => sign.assertAiLinesSigned(userText, U1, doc())).not.toThrow();
  });

  it("a line already stored unchanged is grandfathered — but only an exact match, so it can't be used to smuggle changes", () => {
    const legacy = applySuggestion(doc(), target, "Developed a React application.", { op: "improve", basis: "Built React application." }); // stored before signing existed
    expect(() => sign.assertAiLinesSigned(legacy, U1, legacy)).not.toThrow();
    const changed = structuredClone(legacy);
    changed.sections[0].entries[0].bullets[0].text = "Developed a React application used by 50,000 users.";
    expect(() => sign.assertAiLinesSigned(changed, U1, legacy)).toThrow();
  });

  it("skills rows are signed per row, and a row can't be swapped for another", () => {
    const basis = "Languages: Python, SQL";
    const skillsTarget: Target = { kind: "skills", sectionId: "skl" };
    const rows = ["Languages: SQL, Python"];
    const ok = applySuggestion(doc(), skillsTarget, rows.join("\n"), { op: "skills", basis, rowSigs: rows.map((r) => sign.signAiText(U1, r, basis)) });
    expect(() => sign.assertAiLinesSigned(ok, U1, doc())).not.toThrow();
    const bad = applySuggestion(doc(), skillsTarget, "Languages: SQL, Python, Kubernetes", { op: "skills", basis, rowSigs: rows.map((r) => sign.signAiText(U1, r, basis)) });
    expect(() => sign.assertAiLinesSigned(bad, U1, doc())).toThrow();
  });

  it("the signature travels on the accepted line and survives a JSON round trip (as it does over the network)", () => {
    const l = JSON.parse(JSON.stringify(signed(U1))).sections[0].entries[0].bullets[0];
    expect(l.ai.sig).toMatch(/^[0-9a-f]{32}$/);
    expect(sign.verifyAiText(U1, l.text, l.ai.basis, l.ai.sig)).toBe(true);
  });
});
