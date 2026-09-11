import { z } from "zod";

// Dormant until the owner approves documents, applicability, lifetime and rollout.
// Enabling enforcement without an approved active document must fail closed.
export function consentEnabled(): boolean {
  return process.env.REMHAOS_CONSENT_ENABLED === "true";
}

export const consentDocumentSchema = z.object({
  id: z.string().uuid(),
  purpose: z.enum(["intake", "account"]),
  version: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  body: z.string().min(1),
  operator: z.string().min(1),
});
export type ConsentDocument = z.infer<typeof consentDocumentSchema>;
export type ConsentPurpose = ConsentDocument["purpose"];
export const acceptanceSchema = z.object({
  accepted: z.literal(true),
  documentId: z.string().uuid(),
  requestId: z.string().uuid(),
});
export type ConsentAcceptance = z.infer<typeof acceptanceSchema>;
