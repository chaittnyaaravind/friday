import { z } from "zod";
import { body, ok, withUser } from "@/lib/api";
import { packetDeps } from "@/lib/apply/packet-deps";
import { buildAndSavePacket, getPacketState } from "@/lib/apply/packet-service";

// `nullable().optional()` keeps "omitted" and "null" apart: omitted = keep what the last packet had, null = remove it.
const Build = z.object({
  resumeVersionId: z.string().uuid().nullable().optional(),
  coverLetter: z.string().max(20_000).nullable().optional(),
  extra: z.array(z.object({ question: z.string().trim().min(1).max(500), answer: z.string().max(5_000).nullish().transform((v) => v ?? null) })).max(20).optional(),
});

/** GET /api/applications/:id/packet — the latest packet with its blockers, confirmations and approval state (the listing is re-read live). */
export const GET = withUser<{ id: string }>(async ({ db, user }, { id }) => ok({ state: await getPacketState(db, user.id, id) }));

/**
 * POST /api/applications/:id/packet — prepare (or refresh) the packet. Saves a new snapshot; changes nothing else.
 * Nothing is sent anywhere: this only assembles what the student would submit, for the student to review.
 */
export const POST = withUser<{ id: string }>(async ({ db, user, req }, { id }) => {
  const input = await body(req, Build);
  const state = await buildAndSavePacket(db, user.id, id, input, packetDeps(db, user.id));
  return ok({ state }, { status: 201 });
});
