import { z } from "zod";
import { body, ok, withUser } from "@/lib/api";
import { loadProfileItems, syncMatchingSkills } from "@/lib/resume/profile";
import { SECTION_SCHEMA, SECTIONS } from "@/lib/resume/schemas";

/** GET /api/candidate — your Candidate Profile (every fact, with source and status). */
export const GET = withUser(async ({ db, user }) => {
  const [items, { data: p }] = await Promise.all([loadProfileItems(db, user.id), db.from("profiles").select("resume_reviewed_at").eq("id", user.id).single()]);
  return ok({ items, reviewedAt: p?.resume_reviewed_at ?? null });
});

/** POST /api/candidate — add a fact you supply yourself (status: user_added). */
export const POST = withUser(async ({ db, user, req }) => {
  const { section, data } = await body(req, z.object({ section: z.enum(SECTIONS as [string, ...string[]]), data: z.unknown() }));
  const clean = SECTION_SCHEMA[section as keyof typeof SECTION_SCHEMA].parse(data);
  const { data: last } = await db.from("candidate_items").select("position").eq("user_id", user.id).eq("section", section).order("position", { ascending: false }).limit(1).maybeSingle();
  const { data: item, error } = await db
    .from("candidate_items")
    .insert({ user_id: user.id, section, position: (last?.position ?? -1) + 1, data: clean, source: "user", source_text: null, status: "user_added" })
    .select("*")
    .single();
  if (error) throw error;
  if (section === "skill") await syncMatchingSkills(db, user.id);
  return ok({ item }, { status: 201 });
});
