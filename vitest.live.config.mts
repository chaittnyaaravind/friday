import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Opt-in LIVE checks: `npm run test:live`. These call real public pages/APIs, so they are kept out of the normal
 * suite (which is offline and deterministic). They are how a source earns its "verified" date in capabilities.ts.
 */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["test/live/**/*.live.ts"], testTimeout: 90_000, hookTimeout: 90_000 },
});
