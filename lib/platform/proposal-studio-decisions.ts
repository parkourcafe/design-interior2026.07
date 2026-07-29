import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  resolveProjectStudioValue,
  type ProjectStudioResolution,
} from "./studio-resolver-runtime";

export type ProposalComplexity = "low" | "mid" | "high";

export async function resolveM1ProposalComplexity(
  db: SupabaseClient,
  projectId: string,
): Promise<ProjectStudioResolution<ProposalComplexity>> {
  return resolveProjectStudioValue(db, {
    projectId,
    standardKey: "proposal.complexity",
    platformDefault: "mid",
    schema: z.enum(["low", "mid", "high"]),
  });
}
