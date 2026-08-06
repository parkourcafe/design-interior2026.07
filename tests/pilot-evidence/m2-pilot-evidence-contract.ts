import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const ROLES = ["owner_lead", "architect", "client_approver", "builder", "guest"] as const;
const FORBIDDEN_EXTERNAL = /kitchen-worktop|synthetic[-_ ]?kitchen|demo[-_ ]?(?:package|price|pricing)|generated[-_ ]?(?:price|pricing)/i;

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type PilotManifest = Readonly<Record<string, JsonValue>>;
type JsonObject = Readonly<Record<string, JsonValue>>;

function object(value: JsonValue | undefined): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}
function array(value: JsonValue | undefined): readonly JsonValue[] { return Array.isArray(value) ? value : []; }
function text(value: JsonValue | undefined): string { return typeof value === "string" ? value : ""; }
function integer(value: JsonValue | undefined): number | null { return typeof value === "number" && Number.isSafeInteger(value) ? value : null; }
function timestamp(value: JsonValue | undefined): boolean { return typeof value === "string" && Number.isFinite(Date.parse(value)); }

export function readPilotManifest(path: string): PilotManifest {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("CYCLE7_MANIFEST_OBJECT_REQUIRED");
  return parsed as PilotManifest;
}

export function validateKoraPilot(manifest: PilotManifest): void {
  const project = object(manifest.project); const scope = object(manifest.selectedScope);
  if (manifest.contractVersion !== "archidom.m2-pilot-evidence/0.1"
    || manifest.evidenceClass !== "local_fixture_not_production"
    || project.name !== "Kora Food Hall" || project.model !== "full_project" || project.areaM2 !== 1800
    || !UUID.test(text(project.organizationId)) || !UUID.test(text(project.projectId))
    || !UUID.test(text(scope.packageId)) || text(scope.roomId).length < 1) throw new Error("CYCLE7_KORA_SCOPE_INVALID");
  const sessions = array(manifest.sessions).map(object);
  if (sessions.length !== 5 || new Set(sessions.map((item) => text(item.userId))).size !== 5
    || ROLES.some((role) => !sessions.some((item) => item.role === role))) throw new Error("CYCLE7_FIVE_SESSIONS_REQUIRED");
}

function validateExternalM2(external: PilotManifest): void {
  const flow = object(external.m2); const variants = array(flow.variants).map(object);
  if (variants.length !== 3 || new Set(variants.map((item) => text(item.role))).size !== 3
    || new Set(variants.map((item) => text(item.layoutRevisionId))).size !== 3) throw new Error("CYCLE7_EXTERNAL_EXACT_THREE_VARIANTS_REQUIRED");
  for (const variant of variants) {
    const selections = array(variant.selections).map(object);
    if (!UUID.test(text(variant.layoutRevisionId)) || !SHA256.test(text(variant.semanticHash)) || selections.length < 1) {
      throw new Error("CYCLE7_EXTERNAL_LAYOUT_SELECTION_REQUIRED");
    }
    for (const selection of selections) {
      const price = object(selection.priceObservation); const evidence = object(price.evidence);
      if (text(selection.revisionId).length < 1 || integer(price.amountRub) === null || (integer(price.amountRub) ?? -1) < 0
        || !timestamp(price.observedAt) || text(evidence.sourceRevisionId).length < 1
        || text(evidence.evidenceLinkId).length < 1 || text(evidence.fragmentId).length < 1) {
        throw new Error("CYCLE7_EXTERNAL_PRICE_PROVENANCE_REQUIRED");
      }
    }
  }
  const exercise = object(external.authenticatedExercise); const operations = array(exercise.operations).map(object);
  const required = ["publish_m2_layout_version", "submit_m2_client_review", "review_m2_client_submission", "publish_m2_m3_handoff"];
  if (exercise.environment !== "disposable" || exercise.productionChanged !== false
    || required.some((kind) => !operations.some((item) => item.kind === kind && item.status === "completed" && item.replayVerified === true))
    || exercise.auditVerified !== true || exercise.privacyVerified !== true || exercise.tenancyVerified !== true || exercise.restartVerified !== true) {
    throw new Error("CYCLE7_EXTERNAL_AUTHENTICATED_EXERCISE_REQUIRED");
  }
}

export function validateExternalPilot(external: PilotManifest, kora: PilotManifest): {
  readonly status: "MANIFEST_VALIDATED_PENDING_RUN";
  readonly manifestDigest: `sha256:${string}`;
} {
  if (external.synthetic !== false || FORBIDDEN_EXTERNAL.test(JSON.stringify(external))) throw new Error("CYCLE7_EXTERNAL_SYNTHETIC_FORBIDDEN");
  const provenance = object(external.provenance);
  if (provenance.kind !== "external_real_package" || text(provenance.provider).length < 1 || !timestamp(provenance.receivedAt)) {
    throw new Error("CYCLE7_EXTERNAL_PROVENANCE_REQUIRED");
  }
  const scope = object(external.scope); const koraProject = object(kora.project); const koraScope = object(kora.selectedScope);
  for (const key of ["organizationId", "projectId", "packageId"] as const) {
    const value = text(scope[key]);
    if (!UUID.test(value) || value === text(koraProject[key]) || value === text(koraScope[key])) throw new Error("CYCLE7_EXTERNAL_SCOPE_MUST_BE_DISTINCT");
  }
  const project = object(external.project);
  if (project.name === koraProject.name || scope.roomId === koraScope.roomId) throw new Error("CYCLE7_KORA_CLONE_FORBIDDEN");
  const sources = array(external.sources).map(object);
  if (sources.length < 1 || sources.some((source) => !SHA256.test(text(source.checksum)) || text(source.externalRef).length < 1)) {
    throw new Error("CYCLE7_EXTERNAL_SOURCE_CHECKSUMS_REQUIRED");
  }
  const koraChecksums = new Set([
    "sha256:030d97d805cfb91712f389178323d30a9f41852df933c3838a3a8af92bc92b46",
    ...array(kora.sources).map((source) => text(object(source).checksum)),
  ]);
  if (sources.some((source) => koraChecksums.has(text(source.checksum)))) throw new Error("CYCLE7_KORA_SOURCE_OVERLAP_FORBIDDEN");
  const privatePath = /(?:^|[\\/])(?:Users|home|private|var|tmp)[\\/]|^[A-Za-z]:\\|file:\/\//i;
  const productionFilename = /(?:kora|manifest|production|prod)[-_ ].*\.(?:pdf|dwg|xlsx?|zip|jpg|png)$/i;
  if ([text(provenance.provider), ...sources.map((source) => text(source.externalRef))]
    .some((value) => privatePath.test(value) || productionFilename.test(value))) {
    throw new Error("CYCLE7_EXTERNAL_PRIVACY_INVALID");
  }
  validateExternalM2(external);
  return {
    status: "MANIFEST_VALIDATED_PENDING_RUN" as const,
    manifestDigest: `sha256:${createHash("sha256").update(JSON.stringify(external)).digest("hex")}`,
  };
}
