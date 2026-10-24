import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isHandshakeSender, parseHandshakeAlert } from "./handshake-mail";

// Synthetic: the shape of a Handshake alert card (title link, employer line, "View job" button). Not a real email.
const ALERT = `
<table><tr><td>
  <a href="https://app.joinhandshake.com/stu/jobs/9876543?ref=email&amp;utm_source=alert"><strong>Front Desk Student Assistant</strong></a>
  <p>San José State University · San Jose, CA</p>
  <a href="https://app.joinhandshake.com/stu/jobs/9876543?ref=button">View job</a>
</td></tr><tr><td>
  <p>IT Help Desk Technician</p><a href="https://app.joinhandshake.com/jobs/1234567">View job</a>
</td></tr></table>
<a href="https://app.joinhandshake.com/stu/events/555">Career fair</a>
<a href="https://app.joinhandshake.com/notifications/settings">Unsubscribe</a>`;

describe("parseHandshakeAlert", () => {
  it("keeps one listing per Handshake job id, with the email's own title and employer", () => {
    const jobs = parseHandshakeAlert(ALERT);
    expect(jobs.map((j) => j.handshakeId)).toEqual(["9876543", "1234567"]);
    expect(jobs[0]).toMatchObject({ title: "Front Desk Student Assistant", employer: "San José State University", onCampus: true, url: "https://app.joinhandshake.com/jobs/9876543" });
    expect(jobs[1].title).toBe("IT Help Desk Technician");
  });
  it("ignores events, settings and anything that is not a job link", () => {
    expect(parseHandshakeAlert('<a href="https://app.joinhandshake.com/stu/events/1">Fair</a><a href="https://evil.com/jobs/12345">Job</a>')).toEqual([]);
  });
  it("only trusts mail from joinhandshake.com", () => {
    expect(isHandshakeSender("Handshake <notifications@mail.joinhandshake.com>")).toBe(true);
    expect(isHandshakeSender("x@joinhandshake.com.evil.io")).toBe(false);
  });
});

describe("parseHandshakeAlert on a REAL Handshake saved-search alert (redacted)", () => {
  const real = readFileSync(join(process.cwd(), "test/fixtures/sources/handshake-saved-search-alert.html"), "utf8");
  it("reads every job card: title, employer, pay and on-campus label, with the email's own (tracking) link", () => {
    const jobs = parseHandshakeAlert(real);
    expect(jobs.map((j) => j.title)).toEqual(["Office Student Assistant", "Mentorship Platform Intern", "Graduate Success Coach"]);
    expect(jobs[0]).toMatchObject({ employer: "San Jose State University", payText: "$18.45/hr", onCampus: true, meta: "$18.45/hr • On Campus Student Employment • San Jose, CA (Onsite)" });
    expect(jobs[0].url).toBe("https://email.notifications.joinhandshake.com/c/REDACTED_1");
    expect(jobs[2].payText).toBe("$20–22/hr");
    expect(new Set(jobs.map((j) => j.handshakeId)).size).toBe(3);
  });
  it("the same card in another email gets the same id (no duplicate listing)", () => {
    const again = real.replaceAll("REDACTED_", "OTHERTOKEN_");
    expect(parseHandshakeAlert(again).map((j) => j.handshakeId)).toEqual(parseHandshakeAlert(real).map((j) => j.handshakeId));
  });
  it("header, 'View more', preferences and unsubscribe links are not jobs", () => {
    expect(parseHandshakeAlert(real)).toHaveLength(3);
  });
  it("an off-campus card is not marked on campus", () => {
    const off = real.replace(/San Jose State University<\/span>\s*<span class="job-list-title"[^>]*>Mentorship/, 'CodeNinjas Livermore</span><span class="job-list-title">Mentorship').replace("$25/hr • Internship • San Jose, CA (Hybrid)", "$15–20/hr • Part-Time • Livermore, CA +1 (Onsite)");
    expect(parseHandshakeAlert(off)[1]).toMatchObject({ employer: "CodeNinjas Livermore", onCampus: false });
  });
});
