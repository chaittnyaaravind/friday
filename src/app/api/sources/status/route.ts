import { ok, withUser } from "@/lib/api";
import { loadSourceStatus } from "@/lib/data/source-status";

/** GET /api/sources/status — when each kind of source was last read, and which are failing. Times, counts and flags only. */
export const GET = withUser(async ({ db }) => ok(await loadSourceStatus(db)));
