import { z } from "zod";
import { r1PdfDeclaredGeometrySchema } from "./r1-pdf-fallback-contract";

import { canonicalSerialize, validateLayoutDocument } from "../../../layout-studio/domain";
import type { LayoutDocument } from "../../../layout-studio/domain";

export const PROJECTCEO_COMMAND_CONTRACT_VERSION = "projectceo-command/0.1" as const;

const uuid = z.string().uuid();
const projectSelector = z.object({
  projectId: uuid,
  commandId: uuid,
}).strict();

export const nativeM3ReleasePayloadSchema = z.object({
  packageId: uuid,
  snapshotToken: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  expectedBaselineId: z.string().min(1).max(160).refine(value => value === value.trim()),
  expectedPreviousVersionId: z.string().min(1).max(160).refine(value => value === value.trim()).nullable(),
  expectedStateRevision: z.number().int().safe().nonnegative(),
}).strict();
export type NativeM3ReleasePayload = z.infer<typeof nativeM3ReleasePayloadSchema>;
export function isNativeM3ReleasePayload(value: unknown): value is NativeM3ReleasePayload {
  return nativeM3ReleasePayloadSchema.safeParse(value).success;
}

// Зеркалит VersionScopedEvidenceInput (project-brain.ts) и то, что реально
// проверяет RPC projectceo_product._validate_evidence_array: все шесть полей
// обязательны, до 100 элементов. Обязательно (кроме claimStatus="human_origin",
// см. RPC projectceo_product._append_claim_revision). Регистрация источника
// (register_source) открыта, но она заводит физическую запись инвентаря, а не
// граф утверждений: ссылки на evidence по-прежнему приходят из воркерного
// ingest_source_graph, поэтому из браузера сегодня проходит только
// human_origin с evidence: [].
const versionScopedEvidence = z.object({
  evidenceVersionId: z.string().min(1).max(160),
  evidenceLinkId: z.string().min(1).max(160),
  sourceId: z.string().min(1).max(160),
  sourceNodeId: z.string().min(1).max(160),
  sourceRevisionId: z.string().min(1).max(160),
  fragmentId: z.string().min(1).max(160),
}).strict();

// floor_key / zone_key / discipline_key в таблице инвентаря источников:
// непустая обрезанная строка до 160 символов.
const inventoryKey = z.string().trim().min(1).max(160);
const claimStatus = z.enum(["extracted", "interpreted", "unknown", "human_origin"]);
// nodeId/revisionId границы длины — из projectceo_product._assert_text
// (миграция 20260717101000_projectceo_product_brain_operations.sql).
const nodeId = z.string().trim().min(1).max(160);
const claimRevisionId = z.string().trim().min(1).max(160);
const commitM2Identifier = z.string().min(1).max(160)
  .refine((value) => value === value.trim(), "identifier_must_be_trimmed");
// Candidate selectors contain exact persisted identities only; authority and hashes
// are resolved by the request-bound database command.
const externalReleaseCandidateRef = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("asset_version"), assetVersionId: uuid }).strict(),
  z.object({ kind: z.literal("representation_version"), representationVersionId: uuid }).strict(),
  z.object({ kind: z.literal("documentation_sheet_revision"), sheetId: commitM2Identifier, sheetRevisionId: commitM2Identifier }).strict(),
  z.object({ kind: z.literal("object_representation_binding"), objectRepresentationBindingId: uuid }).strict(),
  z.object({ kind: z.literal("technical_reference_revision"), technicalReferenceRevisionId: uuid }).strict(),
  z.object({ kind: z.literal("annotation_revision"), annotationRevisionId: uuid }).strict(),
]);
export type ExternalReleaseCandidateRef = z.infer<typeof externalReleaseCandidateRef>;

const commitM2IdentifierList = z.array(commitM2Identifier).max(500);
const m2ClientVariant = z.object({
  variantId: commitM2Identifier,
  role: z.enum(["preferred", "value_engineered", "premium"]),
  layoutDocumentId: commitM2Identifier,
  layoutVersionId: commitM2Identifier,
  layoutRevisionId: uuid,
  semanticHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  selectionRevisionIds: commitM2IdentifierList.min(1).refine(
    (ids) => new Set(ids).size === ids.length,
    "selection_revision_ids_must_be_unique",
  ),
  budget: z.object({
    amountRub: z.number().int().safe().nonnegative(),
    staleSelectionRevisionIds: commitM2IdentifierList,
    missingPriceSelectionRevisionIds: commitM2IdentifierList,
  }).strict(),
}).strict();
const m2LayoutSchemaVersion = "project-ceo-m2-layout/0.1" as const;
const maxM2LayoutContentBytes = 65_536;
const maxM2LayoutDepth = 64;
const maxM2LayoutNodes = 10_000;
const maxM2LayoutValues = 50_000;

function prevalidateM2Layout(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;

  const pending: Array<{ readonly value: unknown; readonly depth: number }> = [
    { value, depth: 0 },
  ];
  const seen = new Set<object>();
  let values = 0;

  while (pending.length > 0) {
    const current = pending.pop()!;
    values += 1;
    if (values > maxM2LayoutValues || current.depth > maxM2LayoutDepth) return false;

    const item = current.value;
    if (item === null || typeof item === "string" || typeof item === "boolean") continue;
    if (typeof item === "number") {
      if (!Number.isFinite(item) || (Number.isInteger(item) && !Number.isSafeInteger(item))) return false;
      continue;
    }
    if (typeof item !== "object") return false;
    if (seen.has(item)) return false;
    seen.add(item);

    const children = Array.isArray(item) ? item : Object.values(item);
    for (const child of children) pending.push({ value: child, depth: current.depth + 1 });
  }

  const record = value as Record<string, unknown>;
  if (Object.keys(record).length === 0) return false;
  if (Array.isArray(record.nodes) && record.nodes.length > maxM2LayoutNodes) return false;
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= maxM2LayoutContentBytes;
  } catch {
    return false;
  }
}

// Small browser-safe synchronous SHA-256. The command contract is imported by
// client components too, so node:crypto would turn this shared boundary into a
// server-only module.
export function sha256Hex(text: string): string {
  const rightRotate = (value: number, amount: number): number =>
    (value >>> amount) | (value << (32 - amount));
  const bytes = Array.from(new TextEncoder().encode(text));
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x1_0000_0000);
  const low = bitLength >>> 0;
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((high >>> shift) & 0xff);
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((low >>> shift) & 0xff);

  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  let hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Array<number>(64);
    for (let index = 0; index < 16; index += 1) {
      const start = offset + index * 4;
      words[index] = ((bytes[start]! << 24) | (bytes[start + 1]! << 16)
        | (bytes[start + 2]! << 8) | bytes[start + 3]!) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const w15 = words[index - 15]!;
      const w2 = words[index - 2]!;
      const s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
      const s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
      words[index] = (words[index - 16]! + s0 + words[index - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash as [number, number, number, number, number, number, number, number];
    for (let index = 0; index < 64; index += 1) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choice + constants[index]! + words[index]!) >>> 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      [a, b, c, d, e, f, g, h] = [(temp1 + temp2) >>> 0, a, b, c, (d + temp1) >>> 0, e, f, g];
    }
    hash = hash.map((value, index) => (value + [a, b, c, d, e, f, g, h][index]!) >>> 0);
  }
  return hash.map((value) => value.toString(16).padStart(8, "0")).join("");
}

const m2LayoutContent = z.unknown().refine(prevalidateM2Layout, "layout_content_invalid");

export const projectCeoCommandSchema = z.discriminatedUnion("kind", [
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("submit_m2_client_review"),
    payload: z.object({
      packageId: uuid,
      submissionId: commitM2Identifier,
      revisionId: uuid,
      expectedRevisionId: uuid.nullable(),
      approvalPackageId: commitM2Identifier,
      roomId: commitM2Identifier,
      designIntentRevisionId: commitM2Identifier,
      variants: z.array(m2ClientVariant).length(3).refine(
        (variants) => new Set(variants.map((variant) => variant.role)).size === 3,
        "three_variant_roles_required",
      ),
      budgetAsOf: z.string().datetime({ offset: true }),
      staleAfterDays: z.number().int().safe().positive(),
      reason: z.string().trim().min(3).max(4000),
    }).strict(),
  }).strict(),
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("review_m2_client_submission"),
    payload: z.object({
      packageId: uuid,
      submissionId: commitM2Identifier,
      revisionId: uuid,
      expectedRevisionId: uuid,
      chosenVariantId: commitM2Identifier,
      decision: z.enum(["approved", "rejected", "change_requested"]),
      reason: z.string().trim().min(3).max(4000),
    }).strict(),
  }).strict(),
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("publish_m2_m3_handoff"),
    payload: z.object({
      packageId: uuid,
      handoffId: commitM2Identifier,
      revisionId: uuid,
      expectedRevisionId: uuid.nullable(),
      approvedCommitId: commitM2Identifier,
      approvedCommitRevisionId: uuid,
      reason: z.string().trim().min(3).max(4000),
    }).strict(),
  }).strict(),
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("create_project_fact"),
    payload: z.object({
      factType: z.enum(["requirement", "constraint", "assumption", "open_question"]),
      content: z.object({
        title: z.string().trim().min(1).max(500),
        detail: z.string().max(4000).optional(),
      }).strict(),
      extractionKind: z.enum(["extracted", "interpreted", "human_stated"]),
      sourceId: z.string().trim().min(1).max(160).nullable(),
      sourceRevisionId: z.string().trim().min(1).max(160).nullable(),
      statedReason: z.string().trim().min(3).max(2000).nullable(),
      supersedesFactId: uuid.nullable(),
    }).strict().superRefine((payload, ctx) => {
    const { extractionKind, sourceId, sourceRevisionId, statedReason } = payload;
    if (extractionKind === "human_stated") {
      if (sourceId !== null || sourceRevisionId !== null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["payload", "sourceId"], message: "human_fact_cannot_claim_source" });
      }
      if (statedReason === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["payload", "statedReason"], message: "stated_reason_required" });
      }
    } else if (sourceId === null || sourceRevisionId === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["payload", "sourceId"], message: "source_revision_required" });
    }
    }),
  }).strict(),
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("create_approval_request"),
    payload: z.object({
      subjectKind: z.enum(["project_passport", "client_passport"]),
      subjectId: z.string().trim().min(1).max(160),
      reason: z.string().trim().min(3).max(2000),
    }).strict(),
  }).strict(),
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("submit_approval_request"),
    payload: z.object({ requestId: uuid }).strict(),
  }).strict(),
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("decide_approval_request"),
    payload: z.object({
      requestId: uuid,
      decision: z.enum(["approved", "rejected"]),
      reason: z.string().trim().min(3).max(2000),
    }).strict(),
  }).strict(),
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
    // Подтверждение неполноты прогона архитектором (решение владельца об
    // усечении от 12.08.2026). Отдельная команда, потому что это отдельное
    // решение человека: рассмотреть карточки и принять, что часть влияния
    // осталась за границей политики, — не одно и то же.
    kind: z.literal("acknowledge_impact_truncation"),
    payload: z.object({
      impactRunId: uuid,
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
    // A′: состав выводит сервер, клиент возвращает только снапшот-токен из
    // preview. Дескриптор с клиента больше не принимается — иначе состав
    // версии снова стал бы вводом пользователя, а правило полноты можно было
    // бы обойти, послав неполный список мимо экрана.
    payload: z.object({ snapshotToken: z.string().regex(/^sha256:[0-9a-f]{64}$/i) }).strict(),
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
    kind: z.literal("publish_m2_layout_version"),
    payload: z.object({
      packageId: uuid,
      documentId: commitM2Identifier,
      versionId: commitM2Identifier,
      revisionId: uuid,
      expectedRevisionId: commitM2Identifier.nullable(),
      roomId: commitM2Identifier,
      variantId: commitM2Identifier,
      role: z.enum(["preferred", "value_engineered", "premium"]),
      semanticHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
      schemaVersion: z.literal(m2LayoutSchemaVersion),
      layoutContent: m2LayoutContent,
      reason: z.string().min(3).max(4000)
        .refine((value) => value === value.trim(), "reason_must_be_trimmed"),
    }).strict().superRefine((payload, context) => {
      if (!prevalidateM2Layout(payload.layoutContent)) return;

      const document = payload.layoutContent as unknown as LayoutDocument;
      let valid = false;
      try {
        valid = validateLayoutDocument(document).valid;
      } catch {
        valid = false;
      }
      if (!valid) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["layoutContent"], message: "layout_document_invalid" });
        return;
      }

      if (payload.documentId !== document.documentId) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["documentId"], message: "layout_document_id_mismatch" });
      }
      if (payload.variantId !== document.variant.id) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["variantId"], message: "layout_variant_id_mismatch" });
      }
      if (document.variant.status !== "published") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["layoutContent", "variant", "status"],
          message: "layout_variant_must_be_published",
        });
      }
      const actualHash = `sha256:${sha256Hex(canonicalSerialize(document))}`;
      if (payload.semanticHash !== actualHash) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["semanticHash"], message: "layout_semantic_hash_mismatch" });
      }
    }),
  }).strict(),
  // Intake M3 P0. Зеркалит ровно то, что проверяет RPC
  // register_source_inventory: набор полей записи, словари
  // availability/documentStatus и перекрёстные правила материализованной и
  // плейсхолдерной записи. Одна команда — один документ: пакетный импорт
  // остаётся операционным путём, браузеру он не нужен и расширяет поверхность.
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("register_source"),
    payload: z.object({
      packageId: uuid,
      physicalRecordId: uuid,
      sanitizedName: z.string().trim().min(1).max(500)
        .refine((value) => !/[/\\]/.test(value), "sanitized_name_must_not_contain_path_separators"),
      floorId: inventoryKey,
      zoneId: inventoryKey,
      disciplineId: inventoryKey,
      availability: z.enum(["materialized", "placeholder"]),
      documentStatus: z.enum(["current", "previous", "reference", "unknown"]),
      sizeBytes: z.number().int().safe().nonnegative().nullable().default(null),
      checksum: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
      sourceRevisionId: z.string().trim().min(1).max(160).nullable().default(null),
      semanticConflict: z.boolean().default(false),
    }).strict().superRefine((payload, context) => {
      const materialized = payload.availability === "materialized";
      const carried = [payload.sizeBytes, payload.checksum, payload.sourceRevisionId];
      if (materialized && carried.some((value) => value === null)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["availability"],
          message: "materialized_record_requires_size_checksum_and_revision",
        });
      }
      if (!materialized && carried.some((value) => value !== null)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["availability"],
          message: "placeholder_record_must_not_carry_materialized_fields",
        });
      }
    }),
  }).strict(),
  // Ревизия источника подтверждается тем же человеческим решением, что и любое
  // утверждение: project_intelligence_api.review_claim. Второго механизма
  // ревью не заводится — читающая проекция уже показывает reviewStatus именно
  // из project_intelligence.human_reviews.
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("review_source"),
    payload: z.object({
      targetRevisionId: z.string().trim().min(1).max(160),
      expectedRevisionId: z.string().trim().min(1).max(160),
      decision: z.enum(["confirmed", "rejected"]),
    }).strict().superRefine((payload, context) => {
      // RPC отказывает, если они разошлись; ловим это до сети.
      if (payload.targetRevisionId !== payload.expectedRevisionId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["expectedRevisionId"],
          message: "expected_revision_id_must_match_target",
        });
      }
    }),
  }).strict(),
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("confirm_pdf_dwg_source_pair"),
    payload: z.object({
      packageId: uuid,
      dwgAssetVersionId: uuid,
      pdfAssetVersionId: uuid,
      reason: z.string().min(1).max(2000).refine((value) => value === value.trim(), "reason_must_be_trimmed"),
    }).strict().refine((value) => value.dwgAssetVersionId.toLowerCase() !== value.pdfAssetVersionId.toLowerCase(), "source_versions_must_differ"),
  }).strict(),
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("bind_pdf_dwg_sheet_sidecar"),
    payload: z.object({
      packageId: uuid, confirmationId: uuid,
      sheetId: z.string().min(1).max(160).refine((v) => v === v.trim()),
      sheetRevisionId: z.string().min(1).max(160).refine((v) => v === v.trim()),
      geometry: r1PdfDeclaredGeometrySchema,
      reason: z.string().min(1).max(2000).refine((v) => v === v.trim()),
    }).strict(),
  }).strict(),
  // M3: регистрация листа. Комната, подпись планировки и утверждённый коммит
  // в команде отсутствуют намеренно — происхождение выводит сервер из
  // опубликованного handoff, и параметров для его подмены у RPC просто нет.
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("register_documentation_sheet"),
    payload: z.object({
      packageId: uuid,
      handoffId: inventoryKey,
      handoffRevisionId: inventoryKey,
      sheetId: inventoryKey,
      sheetNumber: z.string().trim().min(1).max(64),
      title: z.string().trim().min(1).max(400),
      revisionId: inventoryKey,
      specificationRevisionIds: z.array(inventoryKey).max(2000).refine(
        (ids) => new Set(ids).size === ids.length,
        "specification_revision_ids_must_be_unique",
      ),
      reason: z.string().trim().min(3).max(4000),
    }).strict(),
  }).strict(),
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("attach_documentation_sheet_specifications"),
    payload: z.object({
      packageId: uuid,
      sheetId: inventoryKey,
      revisionId: inventoryKey,
      expectedRevisionId: inventoryKey,
      specificationRevisionIds: z.array(inventoryKey).min(1).max(2000).refine(
        (ids) => new Set(ids).size === ids.length,
        "specification_revision_ids_must_be_unique",
      ),
      reason: z.string().trim().min(3).max(4000),
    }).strict(),
  }).strict(),
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("attach_external_release_refs"),
    payload: z.object({
      packageId: uuid,
      handoffId: commitM2Identifier,
      handoffRevisionId: commitM2Identifier,
      candidateRefs: z.array(externalReleaseCandidateRef).min(1).max(2000),
      expectedStateRevision: z.number().int().safe().nonnegative(),
    }).strict(),
  }).strict(),
  // Зеркалит publish_baseline: дескриптор с семантическим хешем строит
  // доменный слой (modules/package), сервер пересчитывает дайджест и отвергает
  // расхождение — браузеру здесь нечего доказывать, только предъявить.
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("publish_release"),
    // A′, вторая половина: состав версии выводит сервер из опубликованного
    // baseline, клиент возвращает снапшот-токен из preview. Дескриптор с
    // клиента больше не принимается — иначе состав версии снова стал бы вводом
    // пользователя, а полноту корневого пакета можно было бы обойти, послав
    // урезанный список мимо экрана.
    payload: z.union([
      z.object({ snapshotToken: z.string().regex(/^sha256:[0-9a-f]{64}$/i) }).strict(),
      // Native confirmation coordinates come from the authorized preview. They
      // express what the human saw, never their actor/role/organization grants.
      nativeM3ReleasePayloadSchema,
    ]),
  }).strict(),
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("record_project_stage_revision"),
    payload: z.object({
      stageId: z.enum(["01_brief", "02_concept_offer", "03_preliminary_design", "04_design_development", "05_technical_documentation", "06_preconstruction", "07_construction_closeout"]),
      resultRevisionId: inventoryKey.nullable(),
      ownerUserId: uuid,
      plannedAt: z.string().datetime({ offset: true }).nullable(),
      actualAt: z.string().datetime({ offset: true }).nullable(),
      blockerReason: z.string().trim().min(1).max(4000).nullable(),
      requirements: z.array(z.object({ id: inventoryKey, label: z.string().trim().min(1).max(500), satisfied: z.boolean() }).strict()).max(200),
      approvalStatus: z.enum(["draft", "submitted", "approved", "rejected", "change_requested"]).nullable(),
      approvalRevisionId: inventoryKey.nullable(),
      notApplicableReason: z.string().trim().min(1).max(4000).nullable(),
    }).strict(),
  }).strict(),
  // Сборка и закрытие handover идут через отдельный worker-allowlist
  // (AP3 §10): человеческой команды нет намеренно, и static-boundary тест
  // запрещает её появление в этом сервисе.
  projectSelector.extend({
    contractVersion: z.literal(PROJECTCEO_COMMAND_CONTRACT_VERSION),
    kind: z.literal("build_handover"),
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
  if (
    command.kind === "publish_m2_layout_version"
    && prevalidateM2Layout(command.payload.layoutContent)
    && command.payload.layoutContent.projectId !== command.projectId
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["payload", "layoutContent", "projectId"],
      message: "layout_project_id_mismatch",
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
