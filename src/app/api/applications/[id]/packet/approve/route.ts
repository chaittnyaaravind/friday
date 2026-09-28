import { z } from "zod";
import { body, ok, withUser } from "@/lib/api";
import { approvePacket } from "@/lib/apply/packet-service";

const Approve = z.object({ packetId: z.string().uuid(), contentHash: z.string().regex(/^[0-9a-f]{64}$/), acknowledged: z.array(z.string().max(60)).max(20).default([]) });

/**
 * POST /api/applications/:id/packet/approve — the student's explicit approval of exactly this content.
 * The hash and the ticks are checked against what is stored; a mismatch, a blocker or a missing tick is refused (409).
 */
export const POST = withUser<{ id: string }>(async ({ db, user, req }, { id }) => {
  const input = await body(req, Approve);
  return ok({ state: await approvePacket(db, user.id, id, input) });
});
