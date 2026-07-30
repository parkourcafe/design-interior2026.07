import { z } from "zod";

export const PROJECTCEO_COMMAND_CONTRACT_VERSION = "projectceo-command/0.1" as const;

const uuid = z.string().uuid();
const projectSelector = z.object({
  projectId: uuid,
  commandId: uuid,
}).strict();

export const projectCeoCommandSchema = z.discriminatedUnion("kind", [
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("create_invitation"),
    payload: z.object({
      recipientEmail: z.string().email().max(320),
      targetRole: z.enum(["architect", "builder", "client"]),
      expiresAt: z.string().datetime(),
    }).strict(),
  }).strict(),
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("revoke_invitation"),
    payload: z.object({ invitationId: uuid }).strict(),
  }).strict(),
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("revoke_guest_grant"),
    payload: z.object({ grantId: uuid }).strict(),
  }).strict(),
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("acknowledge_release"),
    payload: z.object({ distributionId: uuid }).strict(),
  }).strict(),
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("create_change"),
    payload: z.object({
      reason: z.string().trim().min(3).max(4000),
      fromProductionPackageVersionId: z.string().min(1).max(160),
      deltaCostRub: z.number().int().safe().min(-1_000_000_000).max(1_000_000_000),
      deltaDays: z.number().int().min(-3650).max(3650),
    }).strict(),
  }).strict(),
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("review_change_impact"),
    payload: z.object({
      impactRunId: uuid,
      impactId: z.string().min(1).max(160),
      disposition: z.enum(["accepted", "resolved", "dismissed"]),
      reason: z.string().trim().min(3).max(4000),
    }).strict(),
  }).strict(),
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("upload_photo_evidence"),
    payload: z.object({
      milestoneId: uuid,
      areaNodeId: z.string().min(1).max(160),
      sourceId: z.string().min(1).max(160),
      sourceRevisionId: z.string().min(1).max(160),
      capturedAt: z.string().datetime(),
      note: z.string().max(2000).nullable(),
    }).strict(),
  }).strict(),
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("review_photo_evidence"),
    payload: z.object({
      photoEvidenceId: uuid,
      decision: z.enum(["accepted", "rejected"]),
      reason: z.string().trim().min(3).max(4000),
    }).strict(),
  }).strict(),
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("accept_milestone"),
    payload: z.object({ milestoneId: uuid }).strict(),
  }).strict(),
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("distribute_release"),
    payload: z.object({
      productionPackageVersionId: z.string().min(1).max(160),
      recipientUserId: uuid,
    }).strict(),
  }).strict(),
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.enum([
      "register_source",
      "review_source",
      "review_selection",
      "publish_baseline",
      "publish_release",
      "build_handover",
    ]),
    payload: z.object({}).strict(),
  }).strict(),
]);

export const PROJECTCEO_INVITATION_ACCEPT_CONTRACT_VERSION =
  "projectceo-invitation-accept/0.1" as const;

export const projectCeoInvitationAcceptSchema = z.object({
  contractVersion: z.literal(PROJECTCEO_INVITATION_ACCEPT_CONTRACT_VERSION),
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict();

export type ProjectCeoCommand = z.infer<typeof projectCeoCommandSchema>;

export type ProjectCeoCommandDraft = ProjectCeoCommand extends infer Command
  ? Command extends { readonly commandId: string }
    ? Omit<Command, "commandId">
    : never
  : never;

export type ProjectCeoCommandResponse =
  | {
      readonly contractVersion: typeof PROJECTCEO_COMMAND_CONTRACT_VERSION;
      readonly requestId: string;
      readonly status: "completed";
      readonly operation: string;
      readonly replay: boolean;
      readonly stateRevision: number;
      readonly result: Readonly<Record<string, unknown>>;
    }
  | {
      readonly contractVersion: typeof PROJECTCEO_COMMAND_CONTRACT_VERSION;
      readonly requestId: string;
      readonly status: "unavailable" | "error";
      readonly error: {
        readonly code:
          | "unauthenticated"
          | "identity_unverified"
          | "forbidden"
          | "not_found"
          | "stale_state"
          | "scope_conflict"
          | "validation_failed"
          | "idempotency_conflict"
          | "operation_unavailable"
          | "internal_error";
        readonly messageKey: string;
        readonly retryable: boolean;
      };
    };
