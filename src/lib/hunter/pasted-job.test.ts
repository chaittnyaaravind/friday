import { describe, expect, it } from "vitest";
import { parsePastedJob } from "./pasted-job";

// Synthetic: the shape of text copied from a Handshake job page. Not a real posting.
const BODY = "The IT Help Desk assists students and staff with account access, Wi-Fi, printing and classroom technology. Duties include answering tickets by phone and email, walking users through password resets, and keeping clear notes in the ticketing system. Training is provided.";
const PAGE = `San José State University
IT Help Desk Student Assistant
San José State University · Higher Education
Posted 2 days ago · Apply by November 7, 2026
Save
Apply
At a glance
$18.45/hr
On-site
San Jose, CA
Part-time
Job description
${BODY}`;

describe("parsePastedJob", () => {
  it("reads the title, employer, pay and campus flag from a pasted Handshake page", () => {
    const r = parsePastedJob(PAGE);
    expect(r && "job" in r && r.job).toMatchObject({ title: "IT Help Desk Student Assistant", employer: "San José State University", payText: "$18.45/hr", onCampus: true });
  });

  it("uses the pasted Handshake job link, normalized, as the link to open", () => {
    const r = parsePastedJob(`${PAGE}\nhttps://sjsu.joinhandshake.com/stu/jobs/11712345?ref=share`);
    expect(r && "job" in r && r.job.url).toBe("https://app.joinhandshake.com/jobs/11712345");
  });

  it("prefers a pasted application form over Handshake's search, and keeps two link-less pastes apart", () => {
    const form = parsePastedJob(`${PAGE}\nApply here: https://forms.gle/AbCdEf123`);
    expect(form && "job" in form && form.job.url).toBe("https://forms.gle/AbCdEf123");
    const a = parsePastedJob(PAGE);
    const b = parsePastedJob(PAGE.replace("IT Help Desk Student Assistant", "Library Student Assistant"));
    expect(a && "job" in a && a.job.url).toMatch(/^https:\/\/app\.joinhandshake\.com\/job-search#pasted-/);
    expect(a && "job" in a && b && "job" in b && a.job.url !== b.job.url).toBe(true);
  });

  it("honors explicit labels", () => {
    const r = parsePastedJob(`Title: Peer Tutor\nDepartment: Associated Students\n${BODY}`);
    expect(r && "job" in r && r.job).toMatchObject({ title: "Peer Tutor", employer: "Associated Students", onCampus: true });
  });

  it("finds the title when it comes before the employer", () => {
    const r = parsePastedJob(`Front Desk Assistant\nSpartan Recreation\n${BODY}`);
    expect(r && "job" in r && r.job).toMatchObject({ title: "Front Desk Assistant", employer: "Spartan Recreation" });
  });

  it("asks for the text when only a Handshake link was sent, and ignores ordinary chat", () => {
    expect(parsePastedJob("https://app.joinhandshake.com/jobs/11712345")).toEqual({ error: "link_only" });
    expect(parsePastedJob("hi friday")).toBeNull();
  });

  it("does not mark an off-campus employer as on campus", () => {
    const r = parsePastedJob(`Barista\nCoffee Co\n${BODY.replace(/students and staff/, "customers")}`);
    expect(r && "job" in r && r.job.onCampus).toBe(false);
  });
});
