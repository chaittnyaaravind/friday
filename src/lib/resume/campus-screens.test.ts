import { describe, expect, it } from "vitest";
import { campusScreens, coveredKeywords } from "./campus-screens";

// Modeled on real SJSU postings read by FRIDAY (Parking Services Office Student Assistant, King Library IT Helpdesk).
const parkingOffice = `Parking Services Office Student Assistant. Assist customers at the front counter, answer phones and questions,
and process permit payments. Cash handling required. Must be proficient in Microsoft Office (Excel, Word).
Requirements: currently enrolled in at least 6 units, minimum 2.0 GPA, valid California driver's license.
Bilingual (Spanish or Vietnamese) preferred. Shifts include some evenings. Maintain confidentiality of customer records.`;

describe("campusScreens", () => {
  it("reads each screen from a real-style posting and checks it against the profile", () => {
    const profile = `Front Desk Volunteer, Public Library: Greeted visitors and answered questions at the front desk.
Cashier, Family Store: Handled cash register transactions. Skills: Microsoft Office, Google Sheets. Languages: Spanish.
Education: San Jose State University, GPA: 3.4`;
    const s = campusScreens(parkingOffice, profile);
    const by = (id: string, label?: string) => s.find((x) => x.id === id && (!label || x.label === label));
    expect(by("customer_service")?.covered).toBe("yes");
    expect(by("software", "Excel")?.covered).toBe("yes"); // covered by "Microsoft Office"
    expect(by("language")?.covered).toBe("yes");
    expect(by("language")?.evidence).toBe("Spanish");
    expect(by("gpa")).toMatchObject({ label: "GPA 2.0+", covered: "yes", evidence: "GPA 3.4" });
    expect(by("units")?.label).toBe("Enrolled in 6+ units");
    expect(by("license")?.covered).toBe("check");
    expect(by("cash")?.covered).toBe("yes");
    expect(by("availability")?.covered).toBe("check");
    expect(by("confidentiality")).toBeTruthy();
    expect(coveredKeywords(s)).toEqual(expect.arrayContaining(["customer service", "Excel", "Spanish"]));
  });

  it("a screen the profile does not show is 'no', and is never offered as a keyword", () => {
    const s = campusScreens(parkingOffice, "Built a Python web scraper for a class project.");
    expect(s.find((x) => x.id === "customer_service")?.covered).toBe("no");
    expect(s.find((x) => x.label === "Excel")?.covered).toBe("no");
    expect(coveredKeywords(s)).toEqual([]);
  });

  it("a GPA below the posting's minimum is reported, not hidden", () => {
    expect(campusScreens("Minimum 3.0 GPA required.", "GPA: 2.7").find((x) => x.id === "gpa")?.covered).toBe("no");
  });

  it("asks nothing the posting does not ask", () => {
    expect(campusScreens("Shelve books in the stacks.", "anything")).toEqual([]);
  });
});
