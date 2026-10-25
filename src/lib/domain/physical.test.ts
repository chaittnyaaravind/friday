import { describe, expect, it } from "vitest";
import { assessPhysical } from "./physical";

describe("assessPhysical — read from the duties, never the title", () => {
  it("heavy lifting is high demand, with the phrase it came from", () => {
    const a = assessPhysical("Unload deliveries and lift up to 50 lbs. Restock shelves throughout the shift.");
    expect(a.level).toBe("high");
    expect(a.flags[0]).toMatchObject({ kind: "lifting", heavy: true });
    expect(a.flags[0].text).toMatch(/50 lbs/);
  });

  it("light lifting alone is moderate, not high — including the common 'up to 25 lbs' line", () => {
    expect(assessPhysical("Answer phones and occasionally lift up to 10 lbs of mail.").level).toBe("moderate");
    // Real Student Union wording (Pinpoint feed, 2026-09-27): an administrative job that states this is moderate, not demanding.
    expect(assessPhysical("Physical demands: Lifting and carrying, often 10-25lbs.")).toMatchObject({ level: "moderate", flags: [{ kind: "lifting", heavy: false }] });
    expect(assessPhysical("Must be able to lift 45 pounds.").level).toBe("high");
  });

  it("standing for long periods is flagged", () => {
    const a = assessPhysical("Greet guests at the information desk. Must be able to stand for long periods.");
    expect(a.flags.map((f) => f.kind)).toContain("standing");
    expect(a.level).toBe("moderate");
  });

  it("moving furniture plus outdoor work is high demand", () => {
    expect(assessPhysical("Set up tables and chairs for events, often outdoors.").level).toBe("high");
  });

  it("a hard schedule is flagged without counting as physical work", () => {
    const a = assessPhysical("Monitor the front desk on overnight shifts. Answer phones, check in residents and log records on the computer. ".repeat(2));
    expect(a.flags.map((f) => f.kind)).toEqual(["schedule"]);
    expect(a.level).toBe("low");
  });

  it("desk work is 'low' only when the description actually describes it", () => {
    const desk = "Greet visitors at the front desk, answer phones and emails, schedule appointments, do data entry in Excel and file records. Training is provided for all student assistants in the office.";
    expect(assessPhysical(desk)).toMatchObject({ level: "low", flags: [] });
    expect(assessPhysical(desk).desk.length).toBeGreaterThanOrEqual(2);
  });

  it("a title that sounds easy is NOT rated easy without duties: no description → unknown", () => {
    expect(assessPhysical("").level).toBe("unknown");
    expect(assessPhysical(null).level).toBe("unknown");
    expect(assessPhysical("Office Assistant — Associated Students. Posted on the official hiring page. Open the application for hours, pay and eligibility.").level).toBe("unknown");
  });
});

describe("hedged CSU boilerplate (\"may be required to …\") is occasional, not demanding", () => {
  // Real text, SJSU Parking Services job descriptions (2026-10-22).
  const BOILER =
    " May be required to do a considerable amount of walking and climbing stairs in parking garages  May also be required to do a varying amount of bending, reaching, moving heavy objects and equipment ";
  it("an office job carrying only the boilerplate is moderate", () => {
    const a = assessPhysical(`Duties: answer phones, data entry, reception and clerical support for permit sales.${BOILER}`);
    expect(a.level).toBe("moderate");
    expect(a.flags.every((f) => f.hedged)).toBe(true);
  });
  it("firmly stated burdens still make a job high", () => {
    const a = assessPhysical(`Assistants are responsible for patrolling the campus parking garages and lots. Will set up barricades and cones at events.${BOILER}`);
    expect(a.level).toBe("high");
  });
});

describe("assessPhysical: light vs strenuous burdens", () => {
  it("rates a counter job with light lifting, boxes and sweeping as some physical work, not demanding", async () => {
    const { assessPhysical } = await import("./physical");
    const clerk = "Assist customers at the print shop counter, take orders and process payments. Must be able to lift or carry paper. Duties include breaking down boxes and sweeping the shop.";
    expect(assessPhysical(clerk).level).toBe("moderate");
  });
  it("keeps outdoor work plus lifting, or moving equipment twice over, as physically demanding", async () => {
    const { assessPhysical } = await import("./physical");
    expect(assessPhysical("Work outdoors at club sports events. Lift and carry gear to the field.").level).toBe("high");
    expect(assessPhysical("Set up tables and chairs for events. Work in all weather conditions.").level).toBe("high");
  });
});
