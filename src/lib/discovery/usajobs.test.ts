import { describe, expect, it } from "vitest";
import { normalizePosting } from "./ingest";
import { mapUsajobsItem, usajobsConfigured, type UsaJobsItem } from "./sources";

// Synthetic fixture in the shape documented at developer.usajobs.gov — for unit tests only, never production data.
const item = (over: Partial<UsaJobsItem["MatchedObjectDescriptor"]> = {}, id = "900001"): UsaJobsItem => ({
  MatchedObjectId: id,
  MatchedObjectDescriptor: {
    PositionTitle: "Student Trainee (Computer Science)",
    PositionURI: `https://www.usajobs.gov/job/${id}`,
    ApplyURI: [`https://www.usajobs.gov/job/${id}/apply`],
    PositionLocationDisplay: "Mountain View, California",
    OrganizationName: "Ames Research Center",
    DepartmentName: "National Aeronautics and Space Administration",
    PositionSchedule: [{ Name: "Internship" }],
    PositionOfferingType: [{ Name: "Student" }],
    PositionRemuneration: [{ MinimumRange: "44000", MaximumRange: "57000", RateIntervalCode: "PA" }],
    PublicationStartDate: "2026-09-20",
    ApplicationCloseDate: "2026-10-30",
    QualificationSummary: "Must be enrolled in a bachelor's program in computer science.",
    UserArea: { Details: { JobSummary: "Support flight software tools.", MajorDuties: ["Write Python tests", "Review code"], RemoteIndicator: false } },
    ...over,
  },
});

describe("usajobsConfigured", () => {
  it("needs both the API key and the registered contact email", () => {
    expect(usajobsConfigured({})).toBe(false);
    expect(usajobsConfigured({ USAJOBS_API_KEY: "k" })).toBe(false);
    expect(usajobsConfigured({ USAJOBS_USER_AGENT: "me@example.com" })).toBe(false);
    expect(usajobsConfigured({ USAJOBS_API_KEY: "k", USAJOBS_USER_AGENT: "me@example.com" })).toBe(true);
  });
});

describe("mapUsajobsItem", () => {
  it("maps a student opening with source, URLs, agency, pay, dates and full description", () => {
    const p = mapUsajobsItem(item())!;
    expect(p).toMatchObject({
      source: "usajobs",
      sourceName: "USAJOBS",
      externalId: "usajobs:900001",
      title: "Student Trainee (Computer Science)",
      applyUrl: "https://www.usajobs.gov/job/900001/apply",
      sourceUrl: "https://www.usajobs.gov/job/900001",
      locationText: "Mountain View, California",
      department: "Ames Research Center · National Aeronautics and Space Administration",
      postedAt: "2026-09-20",
      deadline: "2026-10-30",
      commitment: "Internship",
      payText: "$44,000–$57,000 per year",
      onCampus: false,
    });
    expect(p.description).toContain("Support flight software tools.");
    expect(p.description).toContain("Write Python tests\nReview code");
    expect(p.description).toContain("enrolled in a bachelor's program");
  });

  it("does not turn non-student federal jobs into internships", () => {
    expect(mapUsajobsItem(item({ PositionTitle: "IT Specialist (APPSW)", PositionOfferingType: [{ Name: "Permanent" }] }))).toBeNull();
  });

  it("accepts Pathways/recent-graduate offerings even when the title is generic", () => {
    expect(mapUsajobsItem(item({ PositionTitle: "IT Specialist", PositionOfferingType: [{ Name: "Recent graduates" }] }))).not.toBeNull();
  });

  it("falls back to the position page when there is no apply link, and tolerates missing pay/dates", () => {
    const p = mapUsajobsItem(item({ ApplyURI: undefined, PositionRemuneration: undefined, ApplicationCloseDate: undefined }))!;
    expect(p.applyUrl).toBe("https://www.usajobs.gov/job/900001");
    expect(p.payText).toBeNull();
    expect(p.deadline).toBeNull();
  });

  it("flags remote openings and ignores malformed items", () => {
    expect(mapUsajobsItem(item({ UserArea: { Details: { RemoteIndicator: true } } }))!.isRemoteHint).toBe(true);
    expect(mapUsajobsItem({ MatchedObjectId: "1", MatchedObjectDescriptor: {} as never })).toBeNull();
  });
});

describe("USAJOBS postings through FRIDAY's normal filters", () => {
  const company = { id: "c1", slug: "usajobs" };
  it("a Bay Area student trainee is kept with its source and the API's own deadline", () => {
    const n = normalizePosting(mapUsajobsItem(item())!, company);
    expect("skip" in n).toBe(false);
    if (!("skip" in n)) {
      expect(n.row.deadline).toBe("2026-10-30");
      expect(n.row.apply_url).toBe("https://www.usajobs.gov/job/900001/apply");
      expect(n.row.status).toBe("active");
      expect(n.row.company_id).toBe("c1");
    }
  });
  it("an on-site opening outside the Bay Area is still filtered out", () => {
    const n = normalizePosting(mapUsajobsItem(item({ PositionLocationDisplay: "Washington, District of Columbia" }))!, company);
    expect(n).toEqual({ skip: "outside-bay-area" });
  });
});
