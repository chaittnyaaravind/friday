import { z } from "zod";
import { body, HttpError, ok, withUser } from "@/lib/api";
import { syncMatchingSkills } from "@/lib/resume/profile";
import { SECTION_SCHEMA } from "@/lib/resume/schemas";
import type { Section } from "@/lib/resume/types";

const Patch = z.object({
  data: z.unknown().optional(),
  confirm: z.literal(true).optional(),
  move: z.enum(["up", "down"]).optional(),
});

/**
 * PATCH /api/candidate/:id — edit, confirm, or reorder a fact.
 * Editing or confirming makes it `user_confirmed` (you are the authority); an edit keeps
 * the original source text so the change stays traceable.
 */
export const PATCH = withUser<{ id: string }>(async ({ db, user, req }, { id }) => {
  const input = await body(req, Patch);
  const { data: item } = await db.from("candidate_items").select("*").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!item) throw new HttpError(404, "Item not found");

  if (input.move) {
    const { data: siblings } = await db.from("candidate_items").select("id, position").eq("user_id", user.id).eq("section", item.section).order("position");
    const list = siblings ?? [];
    const i = list.findIndex((s) => s.id === id);
    const j = input.move === "up" ? i - 1 : i + 1;
    if (i >= 0 && j >= 0 && j < list.length) {
      [list[i], list[j]] = [list[j], list[i]];
      await Promise.all(list.map((s, k) => db.from("candidate_items").update({ position: k }).eq("id", s.id)));
    }
    return ok({ moved: true });
  }

  const update: Record<string, unknown> = {};
  if (input.data !== undefined) {
    update.data = SECTION_SCHEMA[item.section as Section].parse(input.data);
    update.status = item.source === "user" ? "user_added" : "user_confirmed";
    update.note = null;
  }
  if (input.confirm) {
    update.status = item.source === "user" ? "user_added" : "user_confirmed";
    update.note = null;
  }
  const { data: saved, error } = await db.from("candidate_items").update(update).eq("id", id).eq("user_id", user.id).select("*").single();
  if (error) throw error;
  if (item.section === "skill") await syncMatchingSkills(db, user.id);
  return ok({ item: saved });
});

/** DELETE /api/candidate/:id — remove an incorrect fact from your profile. */
export const DELETE = withUser<{ id: string }>(async ({ db, user }, { id }) => {
  const { data: item } = await db.from("candidate_items").select("section").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!item) throw new HttpError(404, "Item not found");
  const { error } = await db.from("candidate_items").delete().eq("id", id).eq("user_id", user.id);
  if (error) throw error;
  if (item.section === "skill") await syncMatchingSkills(db, user.id);
  return ok({ deleted: true });
});
