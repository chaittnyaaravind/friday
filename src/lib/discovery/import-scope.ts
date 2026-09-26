/**
 * Rules for a student's own imported listings (see migration 0009). An import is private to its owner, so every
 * identifier it creates is scoped to that student and can never collide with — or overwrite — public catalog rows
 * or another student's imports.
 */
export const IMPORT_DAILY_LIMIT = 30;

/** Only web addresses: URL parsing alone would also accept javascript:, data:, file: and similar schemes. */
export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (u.protocol === "https:" || u.protocol === "http:") && Boolean(u.hostname);
  } catch {
    return false;
  }
}

const short = (userId: string) => userId.replace(/-/g, "").slice(0, 8);

/** A company created by an import lives under a slug only that student can see. */
export const privateCompanySlug = (userId: string, slug: string) => `imp-${short(userId)}-${slug}`;
/** A job created by an import gets a canonical key no other student's import (or the public feed) can equal. */
export const privateCanonical = (userId: string, canonical: string) => `imp:${userId}:${canonical}`;
/** The source row's external id, unique per student even when two students import the same address. */
export const privateExternalId = (userId: string, url: string) => `imp:${short(userId)}:${url}`;
