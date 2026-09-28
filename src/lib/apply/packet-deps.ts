import type { SupabaseClient } from "@supabase/supabase-js";
import { loadActiveJobsForMatching, loadMatchProfile, toMatchJob } from "@/lib/discovery/agent";
import { checkEligibility } from "@/lib/domain/eligibility";
import { computeMatch } from "@/lib/domain/match";
import type { Deps } from "./packet-service";

/** The real eligibility check (the same one the job page shows), wired for the packet service. Null when the listing is not active or the profile is incomplete. */
export const packetDeps = (db: SupabaseClient, userId: string): Deps => ({
  eligibility: async (jobId) => {
    const [profile, jobs] = await Promise.all([loadMatchProfile(db, userId), loadActiveJobsForMatching(db, [jobId])]);
    if (!profile || !jobs[0]) return null;
    const job = toMatchJob(jobs[0]);
    return checkEligibility(profile, job, computeMatch(profile, job).distanceMiles);
  },
});
