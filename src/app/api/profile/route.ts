import { z } from "zod";
import { body, ok, withUser } from "@/lib/api";
import { rematchAll } from "@/lib/discovery/agent";
import { BAY_AREA_CITIES, SJSU } from "@/lib/domain/geo";
import { CampusPrefsSchema, normalizeCampusPrefs } from "@/lib/domain/campus-fit";
import { PrefsSchema } from "@/lib/domain/notify-prefs";
import { SKILLS } from "@/lib/domain/skills";

const url = z.string().url().max(300).nullish().or(z.literal("").transform(() => null));
const Patch = z.object({
  full_name: z.string().max(120).nullish(),
  major: z.string().max(120).nullish(),
  graduation_year: z.number().int().min(2000).max(2100).nullish(),
  gpa: z.number().min(0).max(4.5).nullish(),
  experience_summary: z.string().max(4000).nullish(),
  work_authorization: z.enum(["f1", "us_citizen", "permanent_resident", "other"]).nullish(),
  // Origin is chosen from SJSU or a city — never a precise GPS point.
  origin: z.string().max(60).optional(),
  radius_miles: z.number().int().min(1).max(500).optional(),
  workplace: z.enum(["onsite", "hybrid", "remote", "any"]).optional(),
  availability: z.string().max(200).nullish(),
  desired_titles: z.array(z.string().max(80)).max(12).optional(),
  preferred_industries: z.array(z.string().max(60)).max(12).optional(),
  preferred_locations: z.array(z.string().max(60)).max(12).optional(),
  github_url: url,
  linkedin_url: url,
  portfolio_url: url,
  digest_enabled: z.boolean().optional(),
  notification_prefs: PrefsSchema.optional(),
  /** Campus-fit preferences (pay floor, hours cap, ranked role types, avoid physical / hard schedules). */
  campus_prefs: CampusPrefsSchema.optional(),
  /** true = receive email; false = opted out (sets email_unsubscribed_at). */
  email_alerts: z.boolean().optional(),
  skills: z.array(z.string()).max(80).optional(),
  onboarded: z.boolean().optional(),
});

/** GET /api/profile — your profile and skills. */
export const GET = withUser(async ({ db, user }) => {
  const { data, error } = await db.from("profiles").select("*, profile_skills(source, skills(slug, name, category))").eq("id", user.id).single();
  if (error) throw error;
  return ok({ profile: data, email: user.email });
});

/** PATCH /api/profile — update profile fields and skills, then re-rank every opportunity for you. */
export const PATCH = withUser(async ({ db, user, req }) => {
  const { skills, origin, onboarded, email_alerts, ...fields } = await body(req, Patch);
  const update: Record<string, unknown> = { ...fields };
  if (fields.campus_prefs) update.campus_prefs = normalizeCampusPrefs(fields.campus_prefs); // unknown and dining roles dropped
  if (email_alerts !== undefined) update.email_unsubscribed_at = email_alerts ? null : new Date().toISOString();
  if (origin) {
    const city = BAY_AREA_CITIES.find((c) => c.name === origin);
    Object.assign(update, city ? { origin_label: city.name, origin_lat: city.lat, origin_lng: city.lng } : { origin_label: SJSU.label, origin_lat: SJSU.lat, origin_lng: SJSU.lng });
  }
  if (onboarded) update.onboarded_at = new Date().toISOString();
  if (Object.keys(update).length) {
    const { error } = await db.from("profiles").update(update).eq("id", user.id);
    if (error) throw error;
  }

  if (skills) {
    const valid = new Set(SKILLS.map((s) => s.slug));
    const slugs = [...new Set(skills.filter((s) => valid.has(s)))];
    const { data: rows } = await db.from("skills").select("id, slug").in("slug", slugs.length ? slugs : ["__none__"]);
    const ids = (rows ?? []).map((r) => r.id);
    // Manual list replaces manual skills; resume-derived skills the user removed are removed too.
    await db.from("profile_skills").delete().eq("user_id", user.id).not("skill_id", "in", `(${ids.length ? ids.join(",") : 0})`);
    if (ids.length) await db.from("profile_skills").upsert(ids.map((skill_id) => ({ user_id: user.id, skill_id, source: "manual" })), { onConflict: "user_id,skill_id", ignoreDuplicates: true });
  }

  // Notification preferences don't change any match, so they skip the (expensive) re-rank.
  const preferencesOnly = !skills && !origin && !onboarded && Object.keys(fields).every((k) => k === "notification_prefs");
  if (!preferencesOnly) await rematchAll(db, { userId: user.id });
  return ok({ ok: true });
});
