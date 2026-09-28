import { describe, expect, it } from "vitest";
import { authRestriction, checkEligibility, F1_ON_CAMPUS_WEEKLY_LIMIT, VERDICT_LABEL, type EligibilityCheck } from "./eligibility";
import { isAuthRestricted, type MatchJob, type MatchProfile } from "./match";

type Auth = NonNullable<MatchProfile["workAuthorization"]> | null;
const NOW = Date.parse("2026-09-27T20:00:00Z");

const profile = (auth: Auth, over: Partial<MatchProfile> = {}): MatchProfile => ({
  major: "Computer Science", skills: [], origin: { lat: 37.3352, lng: -121.8811 }, radiusMiles: 25, workplace: "any", desiredTitles: [],
  workAuthorization: auth, graduationYear: 2027, ...over,
});
const job = (over: Partial<MatchJob> = {}): MatchJob => ({
  title: "Software Engineering Intern", employmentType: "internship", category: "Software Engineering", isOnCampus: false,
  lat: 37.35, lng: -121.95, city: "Santa Clara", isRemote: false, isHybrid: false, description: "Build APIs in Python.", requirements: [],
  status: "active", deadline: null, hoursMax: null, workStudy: "not_required", ...over,
});
const run = (auth: Auth, j: Partial<MatchJob> = {}, p: Partial<MatchProfile> = {}) => checkEligibility(profile(auth, p), job(j), null, NOW);
const check = (r: ReturnType<typeof run>, id: EligibilityCheck["id"]) => r.checks.find((c) => c.id === id);

describe("checkEligibility — a plain internship", () => {
  it("nothing in the posting stops a U.S. citizen: clear", () => {
    const r = run("us_citizen");
    expect(r).toMatchObject({ verdict: "clear", headline: "No blockers found in the posting." });
    expect(r.checks.every((c) => c.status === "pass" || c.status === "unknown")).toBe(true);
  });
  it("the verdict labels are stated plainly", () => {
    expect(VERDICT_LABEL).toEqual({ clear: "No blockers found", verify: "Verify before applying", blocked: "Likely blocked" });
  });
});

describe("work authorization — U.S. citizenship required", () => {
  const j = { description: "Applicants must be a U.S. citizen." };
  it.each([
    ["us_citizen", "clear", "pass"],
    ["permanent_resident", "blocked", "fail"],
    ["f1", "blocked", "fail"],
    ["other", "blocked", "fail"],
    [null, "verify", "unknown"],
  ] as const)("%s → %s (%s)", (auth, verdict, status) => {
    const r = run(auth, j);
    expect(r.verdict).toBe(verdict);
    expect(check(r, "authorization")?.status).toBe(status);
  });
});

describe("work authorization — security clearance", () => {
  const j = { description: "This role requires an active Secret clearance." };
  it("a citizen is told to check whether they hold one; everyone else is likely blocked; unknown is asked to add it", () => {
    expect(run("us_citizen", j)).toMatchObject({ verdict: "verify" });
    expect(check(run("us_citizen", j), "authorization")?.detail).toMatch(/cannot tell whether you hold one/);
    for (const a of ["f1", "permanent_resident", "other"] as const) expect(run(a, j).verdict, a).toBe("blocked");
    expect(run(null, j).verdict).toBe("verify");
  });
});

describe("work authorization — 'no sponsorship'", () => {
  const j = { description: "We are unable to sponsor visas for this position." };
  it("does not block an F-1 student (CPT/OPT may apply) but asks them to verify; it does not affect citizens or residents", () => {
    expect(run("f1", j)).toMatchObject({ verdict: "verify" });
    expect(check(run("f1", j), "authorization")?.detail).toMatch(/CPT or OPT/);
    expect(run("us_citizen", j).verdict).toBe("clear");
    expect(run("permanent_resident", j).verdict).toBe("clear");
    expect(run("other", j).verdict).toBe("verify");
  });
});

describe("work authorization — export controls", () => {
  const j = { description: "Work is subject to export control regulations (ITAR)." };
  it("citizens and residents pass; F-1 and other are asked to verify (never blocked: FRIDAY cannot tell if it applies)", () => {
    expect(run("us_citizen", j).verdict).toBe("clear");
    expect(run("permanent_resident", j).verdict).toBe("clear");
    expect(run("f1", j).verdict).toBe("verify");
    expect(run("other", j).verdict).toBe("verify");
    expect(run(null, j).verdict).toBe("verify");
  });
});

describe("work authorization — nothing restricted in the posting", () => {
  it("F-1: on campus is fine; off campus needs CPT/OPT and says FRIDAY cannot confirm it", () => {
    expect(run("f1", { isOnCampus: true, employmentType: "on_campus" }).verdict).toBe("clear");
    const off = run("f1");
    expect(off.verdict).toBe("verify");
    expect(check(off, "authorization")?.detail).toMatch(/CPT or OPT.*cannot confirm/);
  });
  it("an unknown authorization matters only when the role is off campus", () => {
    expect(run(null, { isOnCampus: true, employmentType: "on_campus" }).checks.find((c) => c.id === "authorization")).toBeUndefined();
    expect(run(null).verdict).toBe("verify");
    expect(check(run(null), "authorization")?.status).toBe("unknown");
  });
  it("a citizen or resident has no authorization check at all", () => {
    expect(check(run("us_citizen"), "authorization")).toBeUndefined();
    expect(check(run("permanent_resident"), "authorization")).toBeUndefined();
  });
});

describe("F-1 weekly hours on campus", () => {
  const campus = { isOnCampus: true, employmentType: "on_campus" as const };
  it("hours above the limit ask for verification", () => {
    const r = run("f1", { ...campus, hoursMax: 25 });
    expect(r.verdict).toBe("verify");
    expect(check(r, "hours")).toMatchObject({ status: "warn" });
    expect(check(r, "hours")?.detail).toMatch(/25 hours.*20 hours a week/);
  });
  it("hours within the limit pass; the limit itself is allowed", () => {
    expect(check(run("f1", { ...campus, hoursMax: 15 }), "hours")?.status).toBe("pass");
    expect(check(run("f1", { ...campus, hoursMax: F1_ON_CAMPUS_WEEKLY_LIMIT }), "hours")?.status).toBe("pass");
    expect(run("f1", { ...campus, hoursMax: 20 }).verdict).toBe("clear");
  });
  it("hours not stated is noted but does not by itself demand verification", () => {
    const r = run("f1", campus);
    expect(check(r, "hours")).toMatchObject({ status: "unknown", material: false });
    expect(r.verdict).toBe("clear");
  });
  it("the check exists only for F-1 students on campus", () => {
    expect(check(run("us_citizen", { ...campus, hoursMax: 40 }), "hours")).toBeUndefined();
    expect(check(run("f1", { hoursMax: 40 }), "hours")).toBeUndefined();
  });
});

describe("graduation timing", () => {
  const j = { description: "For students graduating between December 2026 and June 2027." };
  it("passes when the profile's year is targeted; warns when it is not; asks when unknown (without demanding verification)", () => {
    expect(check(run("us_citizen", j, { graduationYear: 2027 }), "graduation")?.status).toBe("pass");
    const off = run("us_citizen", j, { graduationYear: 2029 });
    expect(check(off, "graduation")?.status).toBe("warn");
    expect(off.verdict).toBe("verify");
    const none = run("us_citizen", j, { graduationYear: null });
    expect(check(none, "graduation")).toMatchObject({ status: "unknown", material: false });
    expect(none.verdict).toBe("clear");
  });
  it("a posting that names no graduation year has no graduation check", () => {
    expect(check(run("us_citizen"), "graduation")).toBeUndefined();
  });
});

describe("degree level, experience and Work-Study", () => {
  it("a Ph.D. or master's mention asks for verification", () => {
    expect(run("us_citizen", { description: "Currently pursuing a Ph.D. in machine learning." })).toMatchObject({ verdict: "verify" });
  });
  it("years of professional experience are quoted", () => {
    const r = run("us_citizen", { description: "Requires 5+ years of professional experience." });
    expect(check(r, "experience")?.detail).toMatch(/5\+ years/);
    expect(r.verdict).toBe("verify");
  });
  it("a required Work-Study award asks for verification", () => {
    const r = run("us_citizen", { isOnCampus: true, workStudy: "required" });
    expect(check(r, "work_study")?.status).toBe("warn");
    expect(r.verdict).toBe("verify");
    expect(run("us_citizen", { workStudy: "eligible" }).verdict).toBe("clear");
  });
});

describe("is the listing still open", () => {
  it.each([["closed", /no longer lists/], ["expired", /has expired/], ["broken", /no longer lists/]])("a %s listing is likely blocked", (status, msg) => {
    const r = run("us_citizen", { status });
    expect(r.verdict).toBe("blocked");
    expect(check(r, "open")?.detail).toMatch(msg);
  });
  it("a passed deadline is likely blocked; the deadline day itself is still open", () => {
    expect(run("us_citizen", { deadline: "2026-09-01" }).verdict).toBe("blocked");
    expect(check(run("us_citizen", { deadline: "2026-09-01" }), "open")?.detail).toMatch(/2026-09-01.*passed/);
    expect(run("us_citizen", { deadline: "2026-09-27" }).verdict).toBe("clear");
  });
  it("a near deadline is stated in calendar days (Pacific), not treated as a blocker", () => {
    expect(check(run("us_citizen", { deadline: "2026-09-29" }), "open")?.detail).toMatch(/in 2 days/);
    expect(check(run("us_citizen", { deadline: "2026-09-28" }), "open")?.detail).toMatch(/tomorrow/);
    expect(check(run("us_citizen", { deadline: "2026-09-27" }), "open")?.detail).toMatch(/today/);
    expect(check(run("us_citizen", { deadline: "2026-11-01" }), "open")?.detail).toBe("Open until 2026-11-01.");
  });
});

describe("the verdict", () => {
  it("blocked wins over verify and is explained in the headline", () => {
    const r = run("f1", { status: "closed", description: "Requires 5+ years of professional experience." });
    expect(r.verdict).toBe("blocked");
    expect(r.headline).toMatch(/^Likely blocked: The employer's site no longer lists/);
  });
  it("counts the things to verify, in the singular and the plural", () => {
    expect(run("us_citizen", { description: "PhD required." }).headline).toBe("Verify before applying: 1 thing to check.");
    expect(run("us_citizen", { description: "PhD required. Needs 4+ years of professional experience." }).headline).toBe("Verify before applying: 2 things to check.");
  });
  it("every check carries an id, a label and a reason a person can read", () => {
    const r = run("f1", { isOnCampus: true, employmentType: "on_campus", hoursMax: 30, workStudy: "required", description: "Graduating in 2030. PhD preferred." });
    expect(r.checks.length).toBeGreaterThan(2);
    for (const c of r.checks) {
      expect(c.label).toBeTruthy();
      expect(c.detail.length).toBeGreaterThan(20);
      expect(["pass", "warn", "fail", "unknown"]).toContain(c.status);
    }
  });
  it("always says FRIDAY cannot determine legal eligibility; adds the ISSS notice for F-1 only", () => {
    expect(run("us_citizen").disclaimer).toMatch(/cannot determine legal eligibility/);
    expect(run("us_citizen").disclaimer).not.toMatch(/ISSS/);
    expect(run("f1").disclaimer).toMatch(/cannot determine legal eligibility.*ISSS/);
  });
  it("the score has nothing to do with it: the same posting gives the same verdict whatever the profile's skills or major", () => {
    const a = checkEligibility(profile("us_citizen", { skills: [], major: null }), job(), null, NOW);
    const b = checkEligibility(profile("us_citizen", { skills: ["java", "sql", "python"], major: "Computer Science" }), job(), null, NOW);
    expect(a).toEqual(b);
  });
});

describe("authRestriction — reading the posting", () => {
  it.each([
    ["U.S. citizenship required", "citizen"],
    ["Must be a U.S. Citizen.", "citizen"],
    ["Only US citizens are eligible.", "citizen"],
    ["Active Secret clearance required", "clearance"],
    ["Must hold a Top Secret clearance", "clearance"],
    ["We are unable to sponsor visas.", "sponsor"],
    ["No visa sponsorship is available.", "sponsor"],
    ["without the need for current or future sponsorship", "sponsor"],
    ["Subject to export control laws", "export"],
    ["Regulated under ITAR", "export"],
    ["Great culture and free lunch", null],
    ["", null],
  ])("%s → %s", (text, kind) => {
    const got = authRestriction(text);
    expect(got === "no_sponsorship" ? "sponsor" : got).toBe(kind);
  });
  it("the most restrictive statement wins", () => {
    expect(authRestriction("Must be a U.S. citizen. We cannot offer sponsorship. Export control applies.")).toBe("citizen");
    expect(authRestriction("Active clearance required; no sponsorship.")).toBe("clearance");
  });
  it("EXISTING BEHAVIOR: every posting the old isAuthRestricted flagged is also recognised here", () => {
    for (const s of ["U.S. citizenship is required", "must be a U.S. citizen", "active security clearance", "Secret clearance", "not able to provide visa sponsorship", "no sponsorship", "without the need for current or future visa sponsorship", "export control", "ITAR"]) {
      expect(isAuthRestricted(s), `old: ${s}`).toBe(true);
      expect(authRestriction(s), `new: ${s}`).not.toBeNull();
    }
  });
});
