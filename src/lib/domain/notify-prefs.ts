/**
 * Per-student notification preferences (profiles.notification_prefs). One source of truth for what may
 * become an in-app notification or an email. Anything missing or malformed falls back to a quiet default.
 */
import { z } from "zod";

export const PrefsSchema = z.object({
  email: z.object({
    new_matches: z.boolean(),
    follow_ups: z.boolean(),
    interviews: z.boolean(),
    status_changes: z.boolean(),
  }),
  in_app: z.object({
    new_matches: z.boolean(),
    follow_ups: z.boolean(),
    interviews: z.boolean(),
    closing_soon: z.boolean(),
    source_updates: z.boolean(),
    resume: z.boolean(),
  }),
  min_match_score: z.number().int().min(40).max(95),
});
export type NotificationPrefs = z.infer<typeof PrefsSchema>;

export const DEFAULT_PREFS: NotificationPrefs = {
  email: { new_matches: true, follow_ups: true, interviews: true, status_changes: true },
  in_app: { new_matches: true, follow_ups: true, interviews: true, closing_soon: true, source_updates: false, resume: true },
  min_match_score: 70,
};

const pickBooleans = (group: unknown, defaults: Record<string, boolean>): Record<string, boolean> => {
  const g = (group && typeof group === "object" ? group : {}) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(defaults).map(([k, d]) => [k, typeof g[k] === "boolean" ? (g[k] as boolean) : d]));
};

/** Merge whatever is stored over the defaults, ignoring anything of the wrong type. */
export function normalizePrefs(raw: unknown): NotificationPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const score = typeof r.min_match_score === "number" && Number.isFinite(r.min_match_score) ? Math.round(Math.min(95, Math.max(40, r.min_match_score))) : DEFAULT_PREFS.min_match_score;
  return {
    email: pickBooleans(r.email, DEFAULT_PREFS.email) as NotificationPrefs["email"],
    in_app: pickBooleans(r.in_app, DEFAULT_PREFS.in_app) as NotificationPrefs["in_app"],
    min_match_score: score,
  };
}
