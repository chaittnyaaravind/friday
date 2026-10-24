import { describe, expect, it } from "vitest";
import { checkEligibility } from "./eligibility";
import { computeCampusFit, DEFAULT_CAMPUS_PREFS, hourlyFromPay, isDeskJob, normalizeCampusPrefs, type FitJob } from "./campus-fit";
import type { MatchJob, MatchProfile } from "./match";
import { parsePay } from "./normalize";

const NOW = Date.parse("2026-10-22T18:00:00Z");
const job = (o: Partial<FitJob> = {}): FitJob => ({
  campusRoles: ["front_desk_admin", "student_assistant"], payHourlyMin: 18, payHourlyMax: 20, hoursMax: 15, physical: "low", physicalFlags: [],
  deadline: "2026-11-15", lastVerifiedAt: "2026-10-22T12:00:00Z", official: true, status: "active", ...o,
});
const fit = (o: Partial<FitJob> = {}, prefs = DEFAULT_CAMPUS_PREFS) => computeCampusFit(job(o), prefs, NOW);

describe("computeCampusFit — transparent parts", () => {
  it("the parts add up to the score, and every part explains itself", () => {
    const f = fit();
    expect(f.parts.map((p) => p.key)).toEqual(["role", "pay", "physical", "hours", "listing", "deadline"]);
    expect(f.parts.reduce((s, p) => s + p.points, 0)).toBe(f.score);
    expect(f.parts.reduce((s, p) => s + p.max, 0)).toBe(100);
    for (const p of f.parts) expect(p.detail.length).toBeGreaterThan(10);
    expect(f.score).toBeGreaterThanOrEqual(80);
  });

  it("ranks a well-paid desk job above a lower-paid, physically demanding one", () => {
    const desk = fit();
    const heavy = fit({ campusRoles: ["fitness_recreation"], payHourlyMin: 17, payHourlyMax: 17, physical: "high", physicalFlags: [{ kind: "lifting", text: "lift up to 50 lbs", heavy: true }] });
    expect(desk.score).toBeGreaterThan(heavy.score);
    expect(heavy.cautions.join(" ")).toMatch(/Physically demanding.*lift up to 50 lbs/);
  });

  it("a preferred role type outranks the same job in a role the student did not ask for", () => {
    const prefs = normalizeCampusPrefs({ roles: ["it_support"] });
    expect(fit({ campusRoles: ["it_support"] }, prefs).parts[0].points).toBe(35);
    expect(fit({ campusRoles: ["tutor_mentor"] }, prefs).parts[0].points).toBeLessThan(35);
  });
});

describe("unknown pay is never presented as known", () => {
  it("unknown pay gets a neutral part that SAYS it is unknown, and no pay reason", () => {
    const f = fit({ payHourlyMin: null, payHourlyMax: null });
    const pay = f.parts.find((p) => p.key === "pay")!;
    expect(pay.points).toBe(10);
    expect(pay.detail).toMatch(/not stated/i);
    expect(pay.detail).not.toMatch(/\$/);
    expect(f.reasons.join(" ")).not.toMatch(/Pays/);
  });

  it("stated pay below the student's minimum scores zero and is a caution", () => {
    const f = fit({ payHourlyMin: 17, payHourlyMax: 17 }, normalizeCampusPrefs({ minHourly: 20 }));
    expect(f.parts.find((p) => p.key === "pay")!.points).toBe(0);
    expect(f.cautions.join(" ")).toMatch(/below your \$20\/hr minimum/);
  });

  it("hourlyFromPay keeps ONLY an explicitly hourly figure", () => {
    expect(hourlyFromPay(parsePay("$18.50 - $21.00 per hour"))).toEqual({ min: 18.5, max: 21 });
    expect(hourlyFromPay(parsePay("$18"))).toEqual({ min: null, max: null }); // no stated unit: unknown, not guessed
    expect(hourlyFromPay(parsePay("$1,500 per semester"))).toEqual({ min: null, max: null });
    expect(hourlyFromPay(parsePay("$52,000 per year"))).toEqual({ min: null, max: null });
    expect(hourlyFromPay(null)).toEqual({ min: null, max: null });
  });
});

describe("fit is separate from eligibility and from exclusion", () => {
  it("a high fit does not change the eligibility verdict: an F-1 student offered 30 hours still has to verify the 20-hour cap", () => {
    const f = fit({ hoursMax: 30 });
    expect(f.score).toBeGreaterThan(70);
    const profile: MatchProfile = { major: "CS", skills: [], origin: { lat: 37.3352, lng: -121.8811 }, radiusMiles: 25, workplace: "any", desiredTitles: [], workAuthorization: "f1", graduationYear: 2027 };
    const mj: MatchJob = { title: "Front Desk Assistant", employmentType: "on_campus", category: "Campus", isOnCampus: true, lat: 37.3352, lng: -121.8811, city: "San Jose", isRemote: false, isHybrid: false, description: "30 hours per week", requirements: [], status: "active", deadline: null, hoursMax: 30, workStudy: "unknown" };
    const e = checkEligibility(profile, mj, 0);
    expect(e.verdict).toBe("verify");
    expect(e.checks.find((c) => c.id === "hours")).toMatchObject({ status: "warn" });
    // …and nothing in the fit claims the student is eligible.
    expect(JSON.stringify(f)).not.toMatch(/eligib/i);
  });

  it("hours over the student's own cap, a passed deadline and a closed listing are cautions with no points", () => {
    expect(fit({ hoursMax: 25 }, normalizeCampusPrefs({ maxWeeklyHours: 15 })).cautions.join(" ")).toMatch(/at most 15/);
    expect(fit({ deadline: "2026-10-01" }).parts.find((p) => p.key === "deadline")!.points).toBe(0);
    expect(fit({ status: "closed" }).parts.find((p) => p.key === "listing")!.points).toBe(0);
  });

  it("preferences never allow dining as a preferred role, and malformed stored prefs fall back to defaults", () => {
    expect(normalizeCampusPrefs({ roles: ["dining_retail", "front_desk_admin", "nonsense"] }).roles).toEqual(["front_desk_admin"]);
    expect(normalizeCampusPrefs("garbage")).toEqual(DEFAULT_CAMPUS_PREFS);
    expect(normalizeCampusPrefs(null)).toEqual(DEFAULT_CAMPUS_PREFS);
  });
});

describe("isDeskJob — the desk-only filter (mirrored in search_jobs p_desk_only)", () => {
  it("desk roles and desk-described duties pass; physically demanding never does", () => {
    expect(isDeskJob(["front_desk_admin", "student_assistant"], "moderate")).toBe(true);
    expect(isDeskJob(["student_assistant"], "low")).toBe(true);
    expect(isDeskJob(["it_support"], "high")).toBe(false);
    expect(isDeskJob(["student_assistant"], "unknown")).toBe(false);
    expect(isDeskJob(null, null)).toBe(false);
  });
});
