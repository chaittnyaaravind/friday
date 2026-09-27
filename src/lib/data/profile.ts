import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProfileValues } from "@/components/profile-form";
import { areaFromProfile, type SearchArea } from "@/lib/domain/search-area";

/** Where the student is searching, from the profile FRIDAY already stores (see lib/domain/search-area). */
export async function loadSearchArea(db: SupabaseClient, userId: string): Promise<SearchArea> {
  const { data: p } = await db.from("profiles").select("origin_label, origin_lat, origin_lng, radius_miles, workplace").eq("id", userId).single();
  return areaFromProfile(p);
}

/** Load the signed-in user's profile in the shape the profile form edits. */
export async function loadProfileValues(db: SupabaseClient, userId: string, email?: string | null): Promise<ProfileValues> {
  const { data: p } = await db.from("profiles").select("*, profile_skills(skills(slug))").eq("id", userId).single();
  const skills = ((p?.profile_skills ?? []) as { skills: { slug: string } | null }[]).map((s) => s.skills?.slug).filter(Boolean) as string[];
  return {
    full_name: p?.full_name ?? (email ? email.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) : ""),
    major: p?.major ?? "",
    graduation_year: p?.graduation_year ? String(p.graduation_year) : "",
    gpa: p?.gpa != null ? String(p.gpa) : "",
    work_authorization: p?.work_authorization ?? "",
    origin: p?.origin_label ?? "SJSU Campus",
    radius_miles: p?.radius_miles ?? 25,
    workplace: p?.workplace ?? "any",
    desired_titles: (p?.desired_titles ?? []).join(", "),
    github_url: p?.github_url ?? "",
    linkedin_url: p?.linkedin_url ?? "",
    portfolio_url: p?.portfolio_url ?? "",
    digest_enabled: p?.digest_enabled ?? true,
    skills,
  };
}
