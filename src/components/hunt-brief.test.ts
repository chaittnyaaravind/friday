/**
 * The hunt brief's availability sentence goes into email drafts ("My availability: …"), so it must read as plain
 * English and say only what the student picked.
 */
import { describe, expect, it } from "vitest";
import { availabilityText } from "./hunt-brief";

describe("availabilityText", () => {
  it("joins times in a fixed order and adds the weekly hours", () => {
    expect(availabilityText(["weekends", "afternoons"], 15)).toBe("weekday afternoons and weekends, up to 15 hours a week");
    expect(availabilityText(["mornings", "afternoons", "evenings"], null)).toBe("weekday mornings, weekday afternoons and weekday evenings");
  });

  it("says only what was given, and nothing when nothing was", () => {
    expect(availabilityText([], 10)).toBe("up to 10 hours a week");
    expect(availabilityText(["weekends"], null)).toBe("weekends");
    expect(availabilityText([], null)).toBeNull();
  });
});
