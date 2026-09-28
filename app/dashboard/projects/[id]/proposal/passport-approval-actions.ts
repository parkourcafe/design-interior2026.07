"use server";

import { createClient } from "@/lib/supabase/server";
import { readPassportApproval, type PassportApprovalProgress } from "@/lib/proposal/passport-approval";

// Только чтение: состояние утверждения паспорта под сессией дизайнера.
export async function getPassportApprovalProgress(projectId: string): Promise<PassportApprovalProgress> {
  const supabase = await createClient();
  return readPassportApproval(supabase, projectId);
}
