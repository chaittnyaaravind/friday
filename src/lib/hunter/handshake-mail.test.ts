import { describe, expect, it } from "vitest";
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
