import { z } from "zod";

export const PROJECTCEO_COMMAND_CONTRACT_VERSION = "projectceo-command/0.1" as const;

const uuid = z.string().uuid();
const projectSelector = z.object({
  projectId: uuid,
  commandId: uuid,
}).strict();

// Зеркалит VersionScopedEvidenceInput (project-brain.ts) и то, что реально
// проверяет RPC projectceo_product._validate_evidence_array: все шесть полей
// обязательны, до 100 элементов. Обязательно (кроме claimStatus="human_origin",
// см. RPC projectceo_product._append_claim_revision) — без предварительной
// регистрации источника (register_source/review_source — пока UNAVAILABLE)
// валидных ссылок на evidence не получить, поэтому на практике сегодня
// проходит только human_origin с evidence: [].
const versionScopedEvidence = z.object({
  evidenceVersionId: z.string().min(1).max(160),
  evidenceLinkId: z.string().min(1).max(160),
  sourceId: z.string().min(1).max(160),
  sourceNodeId: z.string().min(1).max(160),
  sourceRevisionId: z.string().min(1).max(160),
  fragmentId: z.string().min(1).max(160),
}).strict();

const claimStatus = z.enum(["extracted", "interpreted", "unknown", "human_origin"]);
// nodeId/revisionId границы длины — из projectceo_product._assert_text
// (миграция 20260717101000_projectceo_product_brain_operations.sql).
const nodeId = z.string().trim().min(1).max(160);
const claimRevisionId = z.string().trim().min(1).max(160);
const revisionIdList = z.array(claimRevisionId).max(500);
const commitM2Identifier = z.string().min(1).max(160)
  .refine((value) => value === value.trim(), "identifier_must_be_trimmed");
const commitM2IdentifierList = z.array(commitM2Identifier).max(500);
const baselineDescriptor = z.object({
  id: claimRevisionId,
  graphVersionId: claimRevisionId,
  previousBaselineId: claimRevisionId.nullable(),
  packageIds: z.array(uuid).max(500),
  sourceRevisionIds: revisionIdList,
  requirementRevisionIds: revisionIdList,
  assumptionRevisionIds: revisionIdList,
  decisionRevisionIds: revisionIdList,
  selectionRevisionIds: revisionIdList,
  approvalPackageIds: revisionIdList,
  semanticHash: z.string().regex(/^sha256:[0-9a-f]{64}$/i),
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
    kind: z.literal("create_decision"),
    payload: z.object({
      packageId: uuid,
      nodeId,
      // Клиент генерирует UUID для новой ревизии — тот же паттерн, что commandId.
      revisionId: uuid,
      expectedRevisionId: claimRevisionId.nullable(),
      claimStatus,
      title: z.string().trim().min(1).max(1000),
      resolution: z.string().trim().min(1).max(8000),
      areaNodeId: nodeId.nullable(),
      decisionStatus: z.enum(["proposed", "confirmed", "superseded"]),
      evidence: z.array(versionScopedEvidence).max(100),
      reason: z.string().trim().min(3).max(4000),
    }).strict(),
  }).strict(),
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("create_selection"),
    payload: z.object({
      packageId: uuid,
      nodeId,
      revisionId: uuid,
      expectedRevisionId: claimRevisionId.nullable(),
      claimStatus,
      title: z.string().trim().min(1).max(1000),
      areaNodeId: nodeId,
      decisionRevisionId: claimRevisionId,
      specification: z.record(z.string().min(1).max(200), z.string().max(4000))
        .refine((spec) => Object.keys(spec).length > 0, "specification_required"),
      evidence: z.array(versionScopedEvidence).max(100),
      reason: z.string().trim().min(3).max(4000),
    }).strict(),
  }).strict(),
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("create_m2_room"),
    payload: z.object({
      packageId: uuid,
      roomId: z.string().trim().min(1).max(160),
      revisionId: z.string().uuid(),
      expectedRevisionId: claimRevisionId.nullable(),
      name: z.string().trim().min(1).max(1000),
      areaM2: z.number().int().safe().positive().max(1_000_000),
      reason: z.string().trim().min(3).max(4000),
    }).strict(),
  }).strict(),
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("create_m2_variant"),
    payload: z.object({
      packageId: uuid,
      variantId: z.string().trim().min(1).max(160),
      revisionId: z.string().uuid(),
      expectedRevisionId: claimRevisionId.nullable(),
      roomId: z.string().trim().min(1).max(160),
      title: z.string().trim().min(1).max(1000),
      description: z.string().max(4000),
      reason: z.string().trim().min(3).max(4000),
    }).strict(),
  }).strict(),
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("create_m2_material"),
    payload: z.object({
      packageId: uuid,
      materialId: z.string().trim().min(1).max(160),
      revisionId: z.string().uuid(),
      expectedRevisionId: claimRevisionId.nullable(),
      variantId: z.string().trim().min(1).max(160),
      name: z.string().trim().min(1).max(1000),
      supplierRef: z.string().max(320),
      unit: z.string().trim().min(1).max(40),
      unitCostRub: z.number().int().safe().nonnegative().max(1_000_000_000),
      quantity: z.number().int().safe().positive().max(1_000_000),
      reason: z.string().trim().min(3).max(4000),
    }).strict(),
  }).strict(),
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("set_m2_budget"),
    payload: z.object({
      packageId: uuid,
      budgetId: z.string().trim().min(1).max(160),
      revisionId: z.string().uuid(),
      expectedRevisionId: claimRevisionId.nullable(),
      minRub: z.number().int().safe().nonnegative().max(1_000_000_000_000),
      maxRub: z.number().int().safe().nonnegative().max(1_000_000_000_000),
      contingencyPct: z.number().int().safe().min(0).max(100),
      reason: z.string().trim().min(3).max(4000),
    }).strict(),
  }).strict(),
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("create_m2_client_handoff"),
    payload: z.object({
      packageId: uuid,
      handoffId: z.string().trim().min(1).max(160),
      revisionId: z.string().uuid(),
      expectedRevisionId: claimRevisionId.nullable(),
      approvalPackageId: z.string().trim().min(1).max(160),
      title: z.string().trim().min(1).max(1000),
      note: z.string().max(8000),
      reason: z.string().trim().min(3).max(4000),
    }).strict(),
  }).strict(),
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("create_approval_package"),
    payload: z.object({
      packageId: uuid,
      // Клиент выбирает id пакета (как nodeId/revisionId выше) — RPC
      // create_approval_package сам проверяет уникальность через idempotency.
      approvalPackageId: z.string().trim().min(1).max(160),
      items: z.array(z.object({
        targetKind: z.enum([
          "requirement_revision",
          "assumption_revision",
          "decision_revision",
          "selection_revision",
        ]),
        entityId: nodeId,
        revisionId: claimRevisionId,
      }).strict()).min(1).max(500),
    }).strict(),
  }).strict(),
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("submit_approval_package"),
    payload: z.object({
      approvalPackageId: z.string().trim().min(1).max(160),
      expectedStatus: z.literal("draft"),
    }).strict(),
  }).strict(),
  // review_selection = capability name that projectceo_product_api.
  // review_approval_package itself checks via
  // _authorize_project_human(project_id, 'review_selection') — confirmed by
  // reading the RPC body, not inferred from the TS side. Despite the name,
  // it reviews an ApprovalPackage as a whole (which may bundle decision_
  // revision/selection_revision/requirement_revision/assumption_revision
  // items together) — there is no separate mechanism to review a single
  // Decision or Selection revision outside this package flow; searched every
  // function in projectceo_product_api and review_approval_package is the
  // only one that touches claim-revision review state.
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("review_selection"),
    payload: z.object({
      approvalPackageId: z.string().trim().min(1).max(160),
      expectedStatus: z.literal("submitted"),
      decision: z.enum(["approved", "rejected", "change_requested"]),
      reason: z.string().trim().min(3).max(4000),
    }).strict(),
  }).strict(),
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("publish_baseline"),
    payload: z.object({ descriptor: baselineDescriptor }).strict(),
  }).strict(),
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("commit_m2_approval"),
    payload: z.object({
      packageId: uuid,
      commitId: commitM2Identifier,
      revisionId: uuid,
      expectedRevisionId: commitM2Identifier.nullable(),
      approvalPackageId: commitM2Identifier,
      roomId: commitM2Identifier,
      designIntentRevisionId: commitM2Identifier,
      chosenVariant: z.object({
        variantId: commitM2Identifier,
        role: z.enum(["preferred", "value_engineered", "premium"]),
        layoutDocumentId: commitM2Identifier,
        layoutVersionId: commitM2Identifier,
        semanticHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
      }).strict(),
      approvedSelectionRevisionIds: commitM2IdentifierList.min(1).refine(
        (ids) => new Set(ids).size === ids.length,
        "approved_selection_revision_ids_must_be_unique",
      ),
      budget: z.object({
        asOf: z.string().datetime({ offset: true }),
        staleAfterDays: z.number().int().safe().positive(),
        amountRub: z.number().int().safe().nonnegative(),
        staleSelectionRevisionIds: commitM2IdentifierList.max(0),
        missingPriceSelectionRevisionIds: commitM2IdentifierList.max(0),
      }).strict(),
      submittedAt: z.string().datetime({ offset: true }),
      reviewedAt: z.string().datetime({ offset: true }),
      submissionReason: z.string().trim().min(3).max(4000),
      reviewReason: z.string().trim().min(3).max(4000),
    }).strict(),
  }).strict(),
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.enum([
      "register_source",
      "review_source",
      "publish_release",
      "build_handover",
    ]),
    payload: z.object({}).strict(),
  }).strict(),
]).superRefine((command, ctx) => {
  if (command.kind === "set_m2_budget" && command.payload.maxRub < command.payload.minRub) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["payload", "maxRub"],
      message: "budget_range_invalid",
    });
  }
  if (
    command.kind === "commit_m2_approval"
    && Date.parse(command.payload.reviewedAt) < Date.parse(command.payload.submittedAt)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["payload", "reviewedAt"],
      message: "reviewed_at_before_submitted_at",
    });
  }
});

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
