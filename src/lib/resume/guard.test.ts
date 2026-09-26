import { describe, expect, it } from "vitest";
import { newFactsIn, skillsLineFacts, verdictOf } from "./guard";

const verdict = (suggestion: string, evidence: string) => verdictOf(newFactsIn(suggestion, evidence));
const claims = (suggestion: string, evidence: string) => newFactsIn(suggestion, evidence).map((f) => f.claim.toLowerCase());

describe("hallucinated fact detection", () => {
  it("REJECTS an invented user count ('Built a website' → '…used by 50,000 users')", () => {
    const facts = newFactsIn("Built a website used by 50,000 users", "Built a website");
    expect(facts.some((f) => f.kind === "number" && f.claim === "50000")).toBe(true);
    expect(verdictOf(facts)).toBe("reject");
  });

  it("FLAGS inflated scope ('Worked with Java' → 'Architected a distributed Java microservices platform')", () => {
    const facts = newFactsIn("Architected a distributed Java microservices platform", "Worked with Java");
    expect(claims("Architected a distributed Java microservices platform", "Worked with Java")).toEqual(expect.arrayContaining(["architected", "distributed", "microservices"]));
    expect(verdictOf(facts)).not.toBe("ok");
  });

  it("rejects an invented percentage even when the metric word exists", () => {
    expect(verdict("Improved API performance by 47%", "Improved API performance")).toBe("reject");
  });

  it("accepts the honest rewrite of the same bullet", () => {
    expect(verdict("Improved API performance through optimized request handling", "Improved API performance")).toBe("confirm"); // 'optimized' is a new outcome claim → attest
    expect(verdict("Improved API performance", "Improved API performance")).toBe("ok");
  });

  it("rejects an invented technology, but not one already in the evidence", () => {
    expect(claims("Built a REST API with Spring Boot and Kafka", "Built a REST API with Spring Boot")).toContain("kafka");
    expect(verdict("Built a REST API with Spring Boot", "Built REST APIs using Spring Boot")).toBe("ok");
  });

  it("does not treat JavaScript as evidence for Java", () => {
    expect(claims("Built a Java service", "Built a JavaScript service")).toContain("java");
  });

  it("rejects invented quantities written as words", () => {
    expect(verdict("Led three engineers", "Worked with engineers")).toBe("reject");
    expect(claims("Supported thousands of users", "Supported users")).toContain("thousands");
  });

  it("flags invented leadership and results but passes what the source already says", () => {
    expect(verdict("Led a team to reduce load times", "Built a caching layer")).toBe("confirm");
    expect(verdict("Led the migration to PostgreSQL", "Led the migration to PostgreSQL")).toBe("ok");
  });

  it("flags an invented employer or product name", () => {
    expect(claims("Built dashboards for Acme Corp customers", "Built dashboards for customers")).toEqual(expect.arrayContaining(["acme", "corp"]));
  });

  it("allows pure rewording: no new numbers, tools, names or claims", () => {
    expect(verdict("Developed a student-focused web application", "Worked on a website for students")).toBe("ok");
    expect(verdict("Built a web app that helps students find tutors", "Built a web app that helps students find tutors")).toBe("ok");
  });

  it("a number present in the evidence is fine, a different one is not", () => {
    expect(verdict("Processed 2,000 records nightly", "Processed 2000 records nightly")).toBe("ok");
    expect(verdict("Processed 20,000 records nightly", "Processed 2000 records nightly")).toBe("reject");
  });
});

describe("skills line guard", () => {
  it("allows regrouping and reordering", () => {
    expect(skillsLineFacts("Languages: Python, Java, SQL", "Languages: SQL, Java, Python")).toEqual([]);
  });
  it("rejects a skill the user never listed", () => {
    expect(skillsLineFacts("Languages: Python, Java", "Languages: Python, Java, Go, React").map((f) => f.claim)).toEqual(["Go", "React"]);
  });
});
