import { describe, expect, it } from "vitest";
import { IMPORT_DAILY_LIMIT, isHttpUrl, privateCanonical, privateCompanySlug, privateExternalId } from "./import-scope";

const A = "11111111-aaaa-4aaa-8aaa-111111111111";
const B = "22222222-bbbb-4bbb-8bbb-222222222222";

describe("isHttpUrl — only web addresses can be imported", () => {
  it("accepts http and https", () => {
    expect(isHttpUrl("https://www.linkedin.com/jobs/view/1")).toBe(true);
    expect(isHttpUrl("http://example.com/apply")).toBe(true);
  });
  it("rejects schemes that a plain URL parser accepts but that must never become a link", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,<script>1</script>", "file:///etc/passwd", "ftp://x.example/a", "vbscript:x", "mailto:a@b.co", "//evil.example", "not a url", ""]) {
      expect(isHttpUrl(bad)).toBe(false);
    }
  });
});

describe("private identifiers never collide across students or with the public catalog", () => {
  const canonical = "stripe|software-engineering-intern|san-francisco";
  it("the same posting gets a different canonical key per student, and never the public one", () => {
    expect(privateCanonical(A, canonical)).not.toBe(privateCanonical(B, canonical));
    expect(privateCanonical(A, canonical)).not.toBe(canonical);
    expect(privateCanonical(A, canonical)).toBe(privateCanonical(A, canonical)); // stable: re-importing reuses the same job
  });
  it("company slugs and source ids are scoped to the student", () => {
    expect(privateCompanySlug(A, "stripe")).not.toBe(privateCompanySlug(B, "stripe"));
    expect(privateCompanySlug(A, "stripe")).not.toBe("stripe");
    const url = "https://example.com/job/1";
    expect(privateExternalId(A, url)).not.toBe(privateExternalId(B, url));
    expect(privateExternalId(A, url)).not.toBe(url);
  });
  it("cannot be forged to equal a feed identifier", () => {
    // Feed ids look like "token:123" / plain slugs; every private id carries an unforgeable imp: / imp- prefix.
    expect(privateCanonical(A, "x").startsWith("imp:")).toBe(true);
    expect(privateExternalId(A, "greenhouse:123").startsWith("imp:")).toBe(true);
    expect(privateCompanySlug(A, "x").startsWith("imp-")).toBe(true);
  });
  it("has a sensible daily limit", () => {
    expect(IMPORT_DAILY_LIMIT).toBeGreaterThanOrEqual(10);
    expect(IMPORT_DAILY_LIMIT).toBeLessThanOrEqual(100);
  });
});
