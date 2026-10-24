import { describe, expect, it } from "vitest";
import { classifyQuestion } from "./questions";

describe("classifyQuestion — personal declarations FRIDAY never answers", () => {
  it.each([
    ["Are you legally authorized to work in the United States?", "work_authorization"],
    ["Will you now or in the future require visa sponsorship?", "sponsorship"],
    ["Are you a U.S. citizen or permanent resident?", "legal_status"],
    ["What is your availability during the semester?", "availability"],
    ["How many hours per week can you work?", "availability"],
    ["Can you work weekends?", "availability"],
    ["What is your expected start date?", "availability"],
    ["Have you ever been terminated from a job?", "employment_history"],
    ["Have you previously worked for SJSU?", "employment_history"],
    ["Do you have a disability? (voluntary)", "disability"],
    ["Do you need any accommodations for the interview?", "disability"],
    ["Gender (optional)", "demographic"],
    ["Race / ethnicity", "demographic"],
    ["Have you ever been convicted of a felony?", "criminal_history"],
    ["Are you a protected veteran?", "veteran"],
    ["I certify that the information above is true and complete.", "certification"],
    ["Please list two references with phone numbers.", "references"],
    ["What are your salary expectations?", "compensation"],
    ["Do you have a Federal Work-Study award?", "work_authorization"],
  ])("%s → %s", (q, kind) => {
    expect(classifyQuestion(q)).toMatchObject({ sensitive: true, kind });
  });

  it.each([
    "Why are you interested in working at the front desk?",
    "Describe a time you helped a customer solve a problem.",
    "What experience do you have with Microsoft Excel?",
    "Tell us about a project you are proud of.",
  ])("ordinary question, may be drafted from approved facts: %s", (q) => {
    expect(classifyQuestion(q)).toEqual({ sensitive: false });
  });
});
