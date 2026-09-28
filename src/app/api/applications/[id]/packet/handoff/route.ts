import { ok, withUser } from "@/lib/api";
import { handOff } from "@/lib/apply/packet-service";

/**
 * POST /api/applications/:id/packet/handoff — the student asks to open the official application. Returns the link only for an
 * approved, unchanged packet whose listing is still open and before its deadline (re-checked now). FRIDAY opens nothing itself
 * and submits nothing: the student opens the link and submits on the employer's site.
 */
export const POST = withUser<{ id: string }>(async ({ db, user }, { id }) => ok(await handOff(db, user.id, id)));
