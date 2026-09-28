/**
 * Guard for closing listings. "A feed no longer returns this posting" is only evidence the posting closed if the
 * feed itself is behaving. When a page is redesigned, an API returns an empty list, or a filter regresses, every
 * listing looks "gone" at once — and closing them all would erase a company's real openings.
 *
 * So closing is refused (and reported, never silent) when either:
 *   empty_feed  the source returned nothing at all but we hold active listings from it, or
 *   mass_close  the run would close more than half of a source's listings (once it has enough to judge).
 * Refused listings stay active; they are NOT marked verified, so they age into "stale" (14 days) and are archived
 * (45 days) if the source really has stopped listing them.
 */
export const MASS_CLOSE_MIN_ACTIVE = 6;
export const MASS_CLOSE_FRACTION = 0.5;

export type CloseBlock = "empty_feed" | "mass_close";
export type CloseDecision = { allow: true } | { allow: false; reason: CloseBlock };

export type CloseInput = {
  /** Postings the adapter returned this run, before FRIDAY's own filters. Omit when unknown: the empty-feed check is then skipped. */
  returned?: number;
  /** Active listings FRIDAY holds from this source for this company. */
  activeBefore: number;
  /** Of those, the ones this run did not see (the would-be closures). */
  candidates: number;
};

export function closeDecision({ returned, activeBefore, candidates }: CloseInput): CloseDecision {
  if (candidates === 0) return { allow: true };
  if (returned === 0 && activeBefore > 0) return { allow: false, reason: "empty_feed" };
  if (activeBefore >= MASS_CLOSE_MIN_ACTIVE && candidates / activeBefore > MASS_CLOSE_FRACTION) return { allow: false, reason: "mass_close" };
  return { allow: true };
}
