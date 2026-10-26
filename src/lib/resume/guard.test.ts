import { describe, expect, it } from "vitest";
import { newFactsIn, skillsLineFacts, summaryFacts, verdictOf } from "./guard";

const verdict = (suggestion: string, evidence: string) => verdictOf(newFactsIn(suggestion, evidence));
const claims = (suggestion: string, evidence: string) => newFactsIn(suggestion, evidence).map((f) => f.claim.toLowerCase());

describe("hallucinated fact detection", () => {
  it("flags open-source, adoption and launch claims the evidence does not make", () => {
    const ev = "Built a job-assistant web app with a Telegram bot";
    expect(newFactsIn("Built open-source tools including a job-assistant web app", ev).map((f) => f.kind)).toContain("scope");
    expect(verdictOf(newFactsIn("Built a web app used by students", ev))).toBe("confirm");
    expect(verdictOf(newFactsIn("Launched a job-assistant web app with a Telegram bot", ev))).toBe("confirm");
    expect(verdictOf(newFactsIn("Created a job-assistant web app with a Telegram bot", ev))).toBe("ok");
    // Ordinary words are not adoption claims.
    expect(verdictOf(newFactsIn("Built a user-friendly job-assistant web app with client-side checks", "Built a job-assistant web app with checks"))).toBe("ok");
    expect(verdictOf(newFactsIn("Greeted customers at the front desk", "Greeted patrons at the front desk"))).toBe("ok");
    expect(verdictOf(newFactsIn("Built a web app with active users", ev))).toBe("confirm");
  });

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

// Synthetic, modeled on the live summaries rejected on 2026-10-25.
describe("summaryFacts", () => {
  const FD9 = { name: "FD9", evidence: "FD9: peer-to-peer file transfer\nTypeScript, React, WebRTC\nCreated a browser app that sends files directly between two devices over WebRTC" };
  const C9 = { name: "Controller-9", evidence: "Controller-9: phone as a game controller\nKotlin, Swift, Rust, Tauri\nWrote the desktop host in Rust" };
  const RESUME = [
    "SUMMARY\nComputer Science student at San José State University who builds and tests web and mobile apps in TypeScript, Kotlin, Swift and Rust.",
    "EDUCATION\nSan José State University — B.S. Computer Science (May 2030)",
    `PROJECTS\n${FD9.evidence}\n${C9.evidence}`,
    "RELEVANT COURSEWORK\nCS 46A: Introduction to Programming (Java)",
    "LEADERSHIP & ACTIVITIES\nStudent Volunteer — College volunteer program (India)",
  ].join("\n");
  const rejects = (s: string) => summaryFacts(s, RESUME, [FD9, C9]).map((f) => f.claim);

  it("rejects a status the resume doesn't state", () => {
    expect(rejects("Recent graduate building web and mobile apps in TypeScript and Kotlin.")).toContain("Recent graduate");
  });
  it("rejects a tool placed on a project that didn't use it", () => {
    expect(rejects("Computer Science student who built FD9, a peer-to-peer file transfer app in WebRTC and Rust, and Controller-9 in Kotlin.")).toContain("Rust");
  });
  it("rejects duties and labels the resume never mentions", () => {
    expect(rejects("Supported peers with coursework and study strategies as a student volunteer in a college volunteer program in India").join(" ")).toMatch(/study/);
    expect(rejects("Computer Science student who built a web scraper for campus jobs.").join(" ")).toMatch(/scraper/);
  });
  it("accepts a summary made of the resume's own facts", () => {
    expect(rejects("Computer Science student at San José State University who built FD9, a peer-to-peer file transfer app in WebRTC, and Controller-9, a phone game controller in Kotlin, Swift and Rust.")).toEqual([]);
  });
});
