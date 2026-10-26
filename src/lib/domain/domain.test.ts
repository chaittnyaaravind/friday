import { describe, expect, it } from "vitest";
import { extractSkills, resolveSkill } from "./skills";
import { resolveLocation, distanceMiles, SJSU } from "./geo";
import { classifyRole, classifyCategory, canonicalKey, decodeEntities, parsePay, htmlToText, parseDeadline } from "./normalize";
import { extractRequirements } from "./requirements";
import { computeMatch, authGuidance, type MatchJob, type MatchProfile } from "./match";

describe("skills", () => {
  it("finds common skills and ignores ambiguous bare words", () => {
    const found = extractSkills("Experience with Java, Spring Boot, SQL and RESTful APIs. We rest on weekends and excel at teamwork.");
    expect(found).toEqual(expect.arrayContaining(["java", "spring", "sql", "rest"]));
    expect(found).not.toContain("excel");
    expect(extractSkills("You will go to meetings")).not.toContain("go");
    expect(extractSkills("Proficient in Python, Go, and Rust")).toContain("go");
    expect(extractSkills("Strong C/C++ skills")).toEqual(expect.arrayContaining(["c", "cpp"]));
    expect(extractSkills("JavaScript and TypeScript")).not.toContain("java");
  });
  it("resolves free-form names", () => {
    expect(resolveSkill("golang")).toBe("go");
    expect(resolveSkill("ReactJS")).toBe("react");
    expect(resolveSkill("postgres")).toBe("postgres");
  });
});

describe("geo", () => {
  it("resolves Bay Area cities and preferences", () => {
    expect(resolveLocation("San Jose, CA").city).toBe("San Jose");
    expect(resolveLocation("USA, CA, Santa Clara").city).toBe("Santa Clara");
    expect(resolveLocation("Mountain View, CA; New York, NY").city).toBe("Mountain View");
    const r = resolveLocation("Remote - US");
    expect(r.isRemote).toBe(true);
    expect(r.inUS).toBe(true);
    expect(resolveLocation("Bangalore").inUS).toBe(false);
    expect(resolveLocation("Dublin, Ireland").city).toBeNull();
    expect(resolveLocation("Dublin, CA").city).toBe("Dublin");
  });
  it("computes distances from SJSU", () => {
    const sc = resolveLocation("Santa Clara, CA");
    const d = distanceMiles(SJSU, { lat: sc.lat!, lng: sc.lng! });
    expect(d).toBeGreaterThan(3);
    expect(d).toBeLessThan(6);
  });
});

describe("normalize", () => {
  it("classifies roles", () => {
    expect(classifyRole("Software Engineering Intern (Summer 2027)").employmentType).toBe("internship");
    expect(classifyRole("Senior Software Engineer").isSenior).toBe(true);
    // A job for people who USED to be interns is not an internship (found in live Adzuna data).
    for (const t of ["Technical Program Manager 1 - Former Intern", "Technical Program Manager II (Former Summer 2026 Interns)", "Engineer, Alumni Intern Program Graduate", "Ex-intern Software Engineer"]) {
      const r = classifyRole(t);
      expect(r.employmentType, t).not.toBe("internship");
      expect(r.isStudentRole && !r.isSenior && r.employmentType === "internship", t).toBe(false);
    }
    expect(classifyRole("Technical Program Manager - Former Intern").isSenior).toBe(true); // manager, no longer shielded as an intern
    // real internships are unaffected
    for (const t of ["Software Engineer Intern", "Software Engineering Internship - Summer 2027", "Machine Learning Intern (Former Employees Welcome)"]) expect(classifyRole(t).employmentType, t).toBe("internship");
    expect(classifyRole("Marketing Intern").isTechnical).toBe(false);
    expect(classifyRole("Lab Assistant", { onCampus: true }).employmentType).toBe("on_campus");
    expect(classifyCategory("Machine Learning Intern")).toBe("AI/ML");
    expect(classifyCategory("SDET Intern")).toBe("QA/SDET");
    expect(classifyCategory("Firmware Engineering Intern")).toBe("Embedded");
    expect(classifyCategory("Software Engineer Intern, Backend")).toBe("Backend");
  });
  it("dedupes across sources", () => {
    const a = canonicalKey("nvidia", "Software Engineering Intern - Summer 2027", "Santa Clara");
    const b = canonicalKey("nvidia", "Software Engineering Internship (Summer 2027)", "Santa Clara");
    expect(a).toBe(b);
    expect(canonicalKey("nvidia", "Software Engineering Intern", "San Jose")).not.toBe(a);
  });
  it("parses pay, html and deadlines", () => {
    expect(parsePay("$45 - $55 per hour")?.text).toBe("$45–$55/hr");
    expect(parsePay("$8,000/month")?.text).toBe("$8K/mo");
    expect(parsePay("no pay listed")).toBeNull();
    expect(htmlToText("<p>Hello&nbsp;<b>world</b></p><ul><li>One</li></ul>")).toBe("Hello world\n• One");
    expect(parseDeadline("Apply by March 3, 2027 to be considered", new Date("2026-09-01"))).toBe("2027-03-03");
  });
});

describe("requirements", () => {
  it("splits required and preferred", () => {
    const desc = `About the team\nWe build infra.\nMinimum Qualifications\n• Java or Python\n• SQL\n• REST APIs\nPreferred Qualifications\n• AWS\n• React is a plus`;
    const reqs = extractRequirements(desc);
    const kind = (s: string) => reqs.find((r) => r.slug === s)?.kind;
    expect(kind("java")).toBe("required");
    expect(kind("sql")).toBe("required");
    expect(kind("aws")).toBe("preferred");
    expect(kind("react")).toBe("preferred");
  });
});

const profile: MatchProfile = {
  major: "Computer Science",
  skills: ["java", "python", "sql", "rest", "dsa"],
  origin: SJSU,
  radiusMiles: 25,
  workplace: "any",
  desiredTitles: ["Software Engineering Intern"],
};
const job: MatchJob = {
  title: "Software Engineering Intern",
  employmentType: "internship",
  category: "Software Engineering",
  isOnCampus: false,
  lat: 37.3541, lng: -121.9552, city: "Santa Clara",
  isRemote: false, isHybrid: false,
  description: "",
  requirements: [
    { slug: "java", label: "Java", kind: "required" },
    { slug: "sql", label: "SQL", kind: "required" },
    { slug: "spring", label: "Spring Boot", kind: "required" },
    { slug: "aws", label: "AWS", kind: "preferred" },
  ],
};

describe("match", () => {
  it("explains strong matches and gaps", () => {
    const m = computeMatch(profile, job);
    const labels = m.strong.map((r) => r.label);
    expect(labels).toEqual(expect.arrayContaining(["Java", "SQL", "Internship position", "Computer Science student"]));
    expect(m.missing).toEqual(expect.arrayContaining([{ label: "Spring Boot", kind: "required" }, { label: "AWS", kind: "preferred" }]));
    expect(m.distanceMiles).toBeLessThan(6);
    expect(m.score).toBeGreaterThan(55);
    expect(m.difficulty).toBe("medium");
  });
  it("marks PhD roles hard and full coverage easy", () => {
    expect(computeMatch(profile, { ...job, description: "PhD required" }).difficulty).toBe("high");
    expect(computeMatch({ ...profile, skills: [...profile.skills, "spring", "aws"] }, job).difficulty).toBe("low");
  });
  it("never over 100, neutral when requirements unknown", () => {
    const m = computeMatch(profile, { ...job, requirements: [] });
    expect(m.score).toBeLessThanOrEqual(100);
    expect(m.missing).toHaveLength(0);
  });
});

describe("work authorization", () => {
  it("never claims CPT approval and always defers to ISSS", () => {
    const g = authGuidance("f1", { employmentType: "internship", isOnCampus: false, description: "" });
    expect(g.status).toBe("requires_verification");
    expect(g.detail).toContain("Verify eligibility with SJSU ISSS");
    expect(g.detail.toLowerCase()).not.toContain("approved");
    expect(authGuidance("f1", { employmentType: "on_campus", isOnCampus: true, description: "" }).status).toBe("potentially_relevant");
    expect(authGuidance("f1", { employmentType: "internship", isOnCampus: false, description: "Must be a U.S. citizen" }).status).toBe("posting_restricts");
    expect(authGuidance("us_citizen", { employmentType: "internship", isOnCampus: false, description: "" }).status).toBe("not_applicable");
  });
});

describe("technical classifier regressions", () => {
  it("keeps engineering/research internships that lack the word 'software'", () => {
    for (const t of [
      "NVIDIA 2027 Internships: Deep Learning",
      "NVIDIA 2027 Internships: Autonomous Vehicles and Robotics",
      "NVIDIA 2027 Internships: Digital Circuit Design",
      "Electrical Engineering Co-Op",
      "2027 Summer Intern, MS/PhD, Quantitative UX Researcher",
      "2027 Summer Intern, PhD, Vehicle Intent and Prediction",
    ]) expect(classifyRole(t).isTechnical, t).toBe(true);
    for (const t of ["Accounting Intern", "Technical Sales - Intern", "Legal Summer Intern", "Growth Marketing Intern"]) expect(classifyRole(t).isTechnical, t).toBe(false);
  });
});

describe("match confidence", () => {
  it("a single matching skill on a hardware role is not a strong match for a CS student", () => {
    const hw: MatchJob = { ...job, title: "Hardware Engineer II Intern", category: "Embedded", requirements: [{ slug: "python", label: "Python", kind: "required" }] };
    const m = computeMatch(profile, hw);
    expect(m.score).toBeLessThan(75);
    expect(m.strong.map((r) => r.label)).not.toContain("Computer Science student");
  });
  it("broad coverage of many requirements still scores strong", () => {
    const rich: MatchJob = { ...job, requirements: ["java", "python", "sql", "rest", "dsa"].map((s) => ({ slug: s, label: s, kind: "required" as const })) };
    expect(computeMatch(profile, rich).score).toBeGreaterThanOrEqual(90);
  });
});

describe("decodeEntities", () => {
  it("decodes the named entities employer pages use, and leaves unknown ones alone", () => {
    expect(decodeEntities("Associated Students&rsquo; mission at San Jos&eacute; State &ndash; 2026")).toBe("Associated Students’ mission at San José State – 2026");
    expect(decodeEntities("&frac12; shift &bogus; &#128640; &#x1F680;")).toBe("½ shift &bogus; 🚀 🚀");
    expect(decodeEntities("&#0; &#99999999;")).toBe("&#0; &#99999999;");
  });
});

// Phrases from live SJSU postings (2026-10-25) that are not skill requirements.
describe("extractSkills: campus boilerplate", () => {
  it("does not read monitoring climbers or budgets as observability", () => {
    expect(extractSkills("Assist with the prevention of emergencies by monitoring the form and technique of climbers")).not.toContain("observability");
    expect(extractSkills("monitoring of Club Sports Team budgets and accounts")).not.toContain("observability");
    expect(extractSkills("Experience with system monitoring and Grafana dashboards")).toContain("observability");
  });
  it("does not read an information security standards clause as cybersecurity", () => {
    expect(extractSkills("Associated Students Information Security Standards as a condition of employment")).not.toContain("cybersecurity");
    expect(extractSkills("Coursework in information security or networking")).toContain("cybersecurity");
  });
});
