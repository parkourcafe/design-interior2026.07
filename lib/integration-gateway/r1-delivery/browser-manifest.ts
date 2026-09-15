export const R1_BROWSER_MANIFEST_VERSION = "r1-browser-manifest/0.1";
export const R1_BROWSER_MANIFEST_MAX_ENTRIES = 500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

type RecordValue = Record<string, unknown>;

export type R1BrowserManifestErrorCode = "validation_failed" | "revoked" | "internal_error";

export class R1BrowserManifestError extends Error {
  constructor(readonly code: R1BrowserManifestErrorCode) {
    super(code);
    this.name = "R1BrowserManifestError";
  }
}

export interface R1BrowserManifest {
  readonly contractVersion: typeof R1_BROWSER_MANIFEST_VERSION;
  readonly projection: {
    readonly source: "structural_manifest_input";
    readonly evidenceId: string;
    readonly scopeRevision: number;
    readonly evaluatedAt: string;
  };
  readonly scope:
    | {
      readonly mode: "authenticated_review";
      readonly projectId: string;
      readonly packageId: string;
      readonly submissionId: string;
    }
    | {
      readonly mode: "guest_release";
      readonly projectId: string;
      readonly packageId: string;
      readonly releaseId: string;
      readonly grantId: string;
    };
  readonly accessLifecycle: "active" | "grace_read_only" | "archive_read_only";
  readonly authorizationDisposition: "broker_recheck_required";
  readonly entries: readonly R1BrowserManifestEntry[];
  readonly deliveryRequirements: {
    readonly cacheControl: "private, no-store";
    readonly requireAuthorizationPerGetAndRange: true;
    readonly maximumOpenStreamRecheckMs: 1000;
    readonly prohibitRawStorageLocator: true;
  };
}

export interface R1BrowserManifestEntry {
  readonly assetVersionId: string;
  readonly representationVersionId: string;
  readonly representationDigest: string;
  readonly versionNo: number;
  readonly format: "glb" | "pdf" | "png";
  readonly status: "current" | "superseded";
  readonly displayLabel: string;
  readonly transform:
    | {
      readonly kind: "3d";
      readonly units: "m" | "mm";
      readonly upAxis: "Y" | "Z";
      readonly matrix: readonly number[];
    }
    | {
      readonly kind: "2d";
      readonly page: number | null;
      readonly rotation: 0 | 90 | 180 | 270;
      readonly crop: {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
      };
    };
}

function record(value: unknown, keys: readonly string[]): RecordValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new R1BrowserManifestError("validation_failed");
  }
  const candidate = value as RecordValue;
  const prototype = Object.getPrototypeOf(candidate);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new R1BrowserManifestError("validation_failed");
  }
  const ownKeys = Reflect.ownKeys(candidate);
  if (ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))) {
    throw new R1BrowserManifestError("validation_failed");
  }
  const descriptors = Object.getOwnPropertyDescriptors(candidate);
  const snapshot: RecordValue = Object.create(null) as RecordValue;
  for (const key of ownKeys as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new R1BrowserManifestError("validation_failed");
    }
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function arrayValues(value: unknown, limits: {
  readonly exact?: number;
  readonly min?: number;
  readonly max?: number;
} = {}): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || Object.getOwnPropertySymbols(value).length > 0) {
    throw new R1BrowserManifestError("validation_failed");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
  const lengthDescriptor = descriptors["length"];
  if (!lengthDescriptor || !("value" in lengthDescriptor)
    || typeof lengthDescriptor.value !== "number" || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 0
    || (limits.exact !== undefined && lengthDescriptor.value !== limits.exact)
    || (limits.min !== undefined && lengthDescriptor.value < limits.min)
    || (limits.max !== undefined && lengthDescriptor.value > limits.max)) {
    throw new R1BrowserManifestError("validation_failed");
  }
  const length = lengthDescriptor.value;
  const allowed = new Set(["length", ...Array.from({ length }, (_, index) => String(index))]);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" || !allowed.has(key))) {
    throw new R1BrowserManifestError("validation_failed");
  }
  const output: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new R1BrowserManifestError("validation_failed");
    }
    output.push(descriptor.value);
  }
  return output;
}

function requireKeys(value: RecordValue, keys: readonly string[]): void {
  if (keys.some((key) => !Object.hasOwn(value, key))) {
    throw new R1BrowserManifestError("validation_failed");
  }
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new R1BrowserManifestError("validation_failed");
  }
  return value.toLowerCase();
}

function boundedNumber(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new R1BrowserManifestError("validation_failed");
  }
  return Object.is(value, -0) ? 0 : value;
}

function safeLabel(value: unknown): string {
  if (typeof value !== "string"
    || value.length < 1
    || value.length > 120
    || value !== value.trim()
    || /[\u0000-\u001f\u007f-\u009f\u2028\u2029\\/]|\p{Cf}/u.test(value)
    || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
    || /\.(?:csv|dae|dwg|glb|jpe?g|pdf|png|skp|xlsx?)$/i.test(value)) {
    throw new R1BrowserManifestError("validation_failed");
  }
  return value;
}

function projection(value: unknown): R1BrowserManifest["projection"] {
  const item = record(value, ["source", "evidenceId", "scopeRevision", "evaluatedAt"]);
  requireKeys(item, ["source", "evidenceId", "scopeRevision", "evaluatedAt"]);
  if (item.source !== "structural_manifest_input"
    || typeof item.scopeRevision !== "number"
    || !Number.isSafeInteger(item.scopeRevision)
    || item.scopeRevision < 0
    || typeof item.evaluatedAt !== "string"
    || !UTC_TIMESTAMP.test(item.evaluatedAt)
    || !Number.isFinite(Date.parse(item.evaluatedAt))) {
    throw new R1BrowserManifestError("validation_failed");
  }
  const parsedEvaluatedAt = new Date(Date.parse(item.evaluatedAt)).toISOString();
  const canonicalInput = item.evaluatedAt.includes(".")
    ? item.evaluatedAt.replace(/\.(\d{1,3})Z$/, (_match, milliseconds: string) => `.${milliseconds.padEnd(3, "0")}Z`)
    : item.evaluatedAt.replace(/Z$/, ".000Z");
  if (parsedEvaluatedAt !== canonicalInput) throw new R1BrowserManifestError("validation_failed");
  return {
    source: item.source,
    evidenceId: uuid(item.evidenceId),
    scopeRevision: item.scopeRevision,
    evaluatedAt: parsedEvaluatedAt,
  };
}

function scope(value: unknown): R1BrowserManifest["scope"] {
  const item = record(value, ["mode", "projectId", "packageId", "submissionId", "releaseId", "grantId"]);
  const projectId = uuid(item.projectId);
  const packageId = uuid(item.packageId);
  if (item.mode === "authenticated_review") {
    requireKeys(item, ["mode", "projectId", "packageId", "submissionId"]);
    if (Object.hasOwn(item, "releaseId") || Object.hasOwn(item, "grantId")) {
      throw new R1BrowserManifestError("validation_failed");
    }
    return { mode: item.mode, projectId, packageId, submissionId: uuid(item.submissionId) };
  }
  if (item.mode === "guest_release") {
    requireKeys(item, ["mode", "projectId", "packageId", "releaseId", "grantId"]);
    if (Object.hasOwn(item, "submissionId")) throw new R1BrowserManifestError("validation_failed");
    return {
      mode: item.mode,
      projectId,
      packageId,
      releaseId: uuid(item.releaseId),
      grantId: uuid(item.grantId),
    };
  }
  throw new R1BrowserManifestError("validation_failed");
}

function crop(value: unknown): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const item = record(value, ["x", "y", "width", "height"]);
  requireKeys(item, ["x", "y", "width", "height"]);
  const result = {
    x: boundedNumber(item.x, 0, 1),
    y: boundedNumber(item.y, 0, 1),
    width: boundedNumber(item.width, 0.000001, 1),
    height: boundedNumber(item.height, 0.000001, 1),
  };
  if (result.width > 1 - result.x || result.height > 1 - result.y) {
    throw new R1BrowserManifestError("validation_failed");
  }
  return result;
}

function transform(value: unknown, format: R1BrowserManifestEntry["format"]): R1BrowserManifestEntry["transform"] {
  const item = record(value, ["kind", "units", "upAxis", "matrix", "page", "rotation", "crop"]);
  if (format === "glb") {
    requireKeys(item, ["kind", "units", "upAxis", "matrix"]);
    if (item.kind !== "3d" || !(["m", "mm"] as const).includes(item.units as "m")
      || !(["Y", "Z"] as const).includes(item.upAxis as "Y")
      || !Array.isArray(item.matrix)
      || Object.hasOwn(item, "page") || Object.hasOwn(item, "rotation") || Object.hasOwn(item, "crop")) {
      throw new R1BrowserManifestError("validation_failed");
    }
    const matrix = arrayValues(item.matrix, { exact: 16 });
    return {
      kind: "3d",
      units: item.units as "m" | "mm",
      upAxis: item.upAxis as "Y" | "Z",
      matrix: Array.from({ length: 16 }, (_, index) => boundedNumber(matrix[index], -1_000_000, 1_000_000)),
    };
  }

  requireKeys(item, ["kind", "page", "rotation", "crop"]);
  if (item.kind !== "2d" || Object.hasOwn(item, "units") || Object.hasOwn(item, "upAxis") || Object.hasOwn(item, "matrix")
    || ![0, 90, 180, 270].includes(item.rotation as number)) {
    throw new R1BrowserManifestError("validation_failed");
  }
  const page = item.page === null ? null : boundedNumber(item.page, 1, 10_000);
  if ((format === "pdf" && (page === null || !Number.isSafeInteger(page))) || (format === "png" && page !== null)) {
    throw new R1BrowserManifestError("validation_failed");
  }
  return { kind: "2d", page, rotation: item.rotation as 0 | 90 | 180 | 270, crop: crop(item.crop) };
}

function entry(value: unknown): R1BrowserManifestEntry {
  const item = record(value, [
    "assetVersionId", "representationVersionId", "representationDigest", "versionNo",
    "format", "status", "displayLabel", "transform",
  ]);
  requireKeys(item, [
    "assetVersionId", "representationVersionId", "representationDigest", "versionNo",
    "format", "status", "displayLabel", "transform",
  ]);
  if (typeof item.representationDigest !== "string" || !DIGEST.test(item.representationDigest)
    || typeof item.versionNo !== "number" || !Number.isSafeInteger(item.versionNo) || item.versionNo < 1
    || !(["glb", "pdf", "png"] as const).includes(item.format as "glb")
    || !(["current", "superseded"] as const).includes(item.status as "current")) {
    throw new R1BrowserManifestError("validation_failed");
  }
  const format = item.format as R1BrowserManifestEntry["format"];
  return {
    assetVersionId: uuid(item.assetVersionId),
    representationVersionId: uuid(item.representationVersionId),
    representationDigest: item.representationDigest,
    versionNo: item.versionNo,
    format,
    status: item.status as R1BrowserManifestEntry["status"],
    displayLabel: safeLabel(item.displayLabel),
    transform: transform(item.transform, format),
  };
}

export function buildR1BrowserManifest(input: unknown): R1BrowserManifest {
  const item = record(input, ["contractVersion", "projection", "scope", "accessLifecycle", "entries"]);
  requireKeys(item, ["contractVersion", "projection", "scope", "accessLifecycle", "entries"]);
  if (item.contractVersion !== R1_BROWSER_MANIFEST_VERSION || !Array.isArray(item.entries)) {
    throw new R1BrowserManifestError("validation_failed");
  }
  if (item.accessLifecycle === "revoked") throw new R1BrowserManifestError("revoked");
  if (!(["active", "grace_read_only", "archive_read_only"] as const).includes(item.accessLifecycle as "active")) {
    throw new R1BrowserManifestError("validation_failed");
  }

  const entries = arrayValues(item.entries, { min: 1, max: R1_BROWSER_MANIFEST_MAX_ENTRIES })
    .map(entry).sort((left, right) => (
    left.representationVersionId < right.representationVersionId
      ? -1
      : left.representationVersionId > right.representationVersionId ? 1 : 0
  ));
  if (new Set(entries.map((candidate) => candidate.representationVersionId)).size !== entries.length) {
    throw new R1BrowserManifestError("validation_failed");
  }

  return {
    contractVersion: R1_BROWSER_MANIFEST_VERSION,
    projection: projection(item.projection),
    scope: scope(item.scope),
    accessLifecycle: item.accessLifecycle as R1BrowserManifest["accessLifecycle"],
    authorizationDisposition: "broker_recheck_required",
    entries,
    deliveryRequirements: {
      cacheControl: "private, no-store",
      requireAuthorizationPerGetAndRange: true,
      maximumOpenStreamRecheckMs: 1000,
      prohibitRawStorageLocator: true,
    },
  };
}
