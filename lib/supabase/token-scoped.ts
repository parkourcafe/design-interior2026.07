import { createAdminClient } from "@/lib/supabase/admin";

// Existing server-side exceptions only. This allowlist records purpose; it does
// not validate a token, constrain SQL, grant permissions, or replace route auth.
// Authenticated and system exceptions are deliberately named separately.
const purposes = new Set([
  "intake-start",
  "intake-submit",
  "intake-upload",
  "client-bootstrap",
  "proposal-response",
  "public-proposal",
  "public-brief",
  "participant-room",
  "authenticated-plan-upload",
  "participant-task-status",
  "system-rate-limit",
  "system-ai-recording",
  "authenticated-account-delete",
  "system-telegram-webhook",
  "system-integration-worker",
  "public-intake-read",
  "public-designer-read",
  "invite-preview",
  "invite-accept",
] as const);

type ServicePurpose = typeof purposes extends Set<infer Purpose> ? Purpose : never;

export function createScopedServiceClient(purpose: ServicePurpose) {
  if (typeof window !== "undefined" || !purposes.has(purpose)) {
    throw new Error("service_role_purpose_not_allowed");
  }
  return createAdminClient();
}
