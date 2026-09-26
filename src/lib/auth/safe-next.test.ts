import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-next";
describe("safe auth destinations", () => {
  it("retains local destinations", () => {expect(safeNextPath("/applications?status=saved")).toBe("/applications?status=saved");});
  it.each(["https://evil.example", "javascript:alert(1)", "//evil.example", "/\\evil.example", "/%5cevil.example", "/%2fevil.example", "/\nevil.example", "%2Fdashboard", "/%invalid", null])("rejects %s", value => {expect(safeNextPath(value)).toBe("/dashboard");});
});
