export const R1_VIEWER_STATE_VERSION = "r1-viewer-state/0.2";

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_ID = /^[A-Za-z0-9:_-]{1,128}$/;

type JsonRecord = Record<string, unknown>;

export interface R1ViewerCamera3d {
  readonly kind: "3d";
  readonly yaw: number;
  readonly pitch: number;
  readonly zoom: number;
  readonly target: readonly [number, number, number];
}

export interface R1ViewerCamera2d {
  readonly kind: "2d";
  readonly page: number | null;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly zoom: number;
  readonly pan: readonly [number, number];
}

export interface R1ViewerRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface R1ViewerState {
  readonly contractVersion: typeof R1_VIEWER_STATE_VERSION;
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
  readonly representation: {
    readonly versionId: string;
    readonly digest: string;
    readonly format: "glb" | "pdf" | "png";
    readonly status: "current" | "superseded";
    readonly displayLabel: string;
  };
  readonly access: {
    readonly lifecycle: "active" | "grace_read_only" | "archive_read_only" | "revoked";
    readonly evidenceId: string;
    readonly revision: number;
  };
  readonly camera: R1ViewerCamera3d | R1ViewerCamera2d;
  readonly selection: {
    readonly objectId: string;
    readonly representationDigest: string;
    readonly region: R1ViewerRegion | null;
  } | null;
  readonly presentation: {
    readonly historical: boolean;
    readonly warning: "none" | "superseded_history" | "access_revoked";
    readonly byteRequestDisposition: "broker_authorization_required" | "deny_revoked";
    readonly newDispatchCandidate: boolean;
  };
  readonly deliveryRequirements: {
    readonly cacheControl: "private, no-store";
    readonly requireBrokerAuthorizationPerRequest: true;
    readonly maximumRangeReauthorizationIntervalMs: 1000;
    readonly prohibitRawStorageLocator: true;
  };
}

function strictRecord(value: unknown, allowedKeys: readonly string[], code: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(code);
  }

  const record = value as JsonRecord;
  const prototype = Object.getPrototypeOf(record);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(code);
  }
  if (Object.keys(record).some((key) => !allowedKeys.includes(key))) {
    throw new Error(code);
  }

  return record;
}

function exactKeys(record: JsonRecord, requiredKeys: readonly string[], code: string): void {
  if (requiredKeys.some((key) => !Object.hasOwn(record, key))) {
    throw new Error(code);
  }
}

function uuid(value: unknown, code: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(code);
  return value.toLowerCase();
}

function digest(value: unknown): string {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new Error("r1_viewer_representation_invalid");
  }
  return value;
}

function finite(value: unknown, min: number, max: number, code: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(code);
  }
  return Object.is(value, -0) ? 0 : value;
}

function safeDisplayLabel(value: unknown): string {
  if (typeof value !== "string"
    || value.length < 1
    || value.length > 120
    || value !== value.trim()
    || /[\u0000-\u001f\u007f\\/]/.test(value)
    || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
    || /\.(?:csv|dae|dwg|glb|jpe?g|pdf|png|skp|xlsx?)$/i.test(value)) {
    throw new Error("r1_viewer_display_label_invalid");
  }
  return value;
}

function parseScope(value: unknown): R1ViewerState["scope"] {
  const record = strictRecord(
    value,
    ["mode", "projectId", "packageId", "submissionId", "releaseId", "grantId"],
    "r1_viewer_scope_invalid",
  );
  const projectId = uuid(record.projectId, "r1_viewer_scope_invalid");
  const packageId = uuid(record.packageId, "r1_viewer_scope_invalid");

  if (record.mode === "authenticated_review") {
    exactKeys(record, ["mode", "projectId", "packageId", "submissionId"], "r1_viewer_scope_invalid");
    if (Object.hasOwn(record, "releaseId") || Object.hasOwn(record, "grantId")) {
      throw new Error("r1_viewer_scope_invalid");
    }
    return {
      mode: record.mode,
      projectId,
      packageId,
      submissionId: uuid(record.submissionId, "r1_viewer_scope_invalid"),
    };
  }

  if (record.mode === "guest_release") {
    exactKeys(record, ["mode", "projectId", "packageId", "releaseId", "grantId"], "r1_viewer_scope_invalid");
    if (Object.hasOwn(record, "submissionId")) throw new Error("r1_viewer_scope_invalid");
    return {
      mode: record.mode,
      projectId,
      packageId,
      releaseId: uuid(record.releaseId, "r1_viewer_scope_invalid"),
      grantId: uuid(record.grantId, "r1_viewer_scope_invalid"),
    };
  }

  throw new Error("r1_viewer_scope_invalid");
}

function parseRepresentation(value: unknown): R1ViewerState["representation"] {
  const record = strictRecord(
    value,
    ["versionId", "digest", "format", "status", "displayLabel"],
    "r1_viewer_representation_invalid",
  );
  exactKeys(record, ["versionId", "digest", "format", "status", "displayLabel"], "r1_viewer_representation_invalid");
  if (!(["glb", "pdf", "png"] as const).includes(record.format as "glb")) {
    throw new Error("r1_viewer_representation_invalid");
  }
  if (!(["current", "superseded"] as const).includes(record.status as "current")) {
    throw new Error("r1_viewer_representation_invalid");
  }
  return {
    versionId: uuid(record.versionId, "r1_viewer_representation_invalid"),
    digest: digest(record.digest),
    format: record.format as R1ViewerState["representation"]["format"],
    status: record.status as R1ViewerState["representation"]["status"],
    displayLabel: safeDisplayLabel(record.displayLabel),
  };
}

function parseAccess(value: unknown): R1ViewerState["access"] {
  const record = strictRecord(value, ["lifecycle", "evidenceId", "revision"], "r1_viewer_access_invalid");
  exactKeys(record, ["lifecycle", "evidenceId", "revision"], "r1_viewer_access_invalid");
  if (!(["active", "grace_read_only", "archive_read_only", "revoked"] as const)
    .includes(record.lifecycle as "active")) {
    throw new Error("r1_viewer_access_invalid");
  }
  if (typeof record.revision !== "number" || !Number.isSafeInteger(record.revision) || record.revision < 0) {
    throw new Error("r1_viewer_access_invalid");
  }
  return {
    lifecycle: record.lifecycle as R1ViewerState["access"]["lifecycle"],
    evidenceId: uuid(record.evidenceId, "r1_viewer_access_invalid"),
    revision: record.revision as number,
  };
}

function parseCamera(value: unknown, format: R1ViewerState["representation"]["format"]): R1ViewerState["camera"] {
  const record = strictRecord(
    value,
    ["kind", "yaw", "pitch", "zoom", "target", "page", "rotation", "pan"],
    "r1_viewer_camera_invalid",
  );

  if (format === "glb") {
    exactKeys(record, ["kind", "yaw", "pitch", "zoom", "target"], "r1_viewer_camera_invalid");
    if (record.kind !== "3d" || !Array.isArray(record.target) || record.target.length !== 3
      || Object.hasOwn(record, "page") || Object.hasOwn(record, "rotation") || Object.hasOwn(record, "pan")) {
      throw new Error("r1_viewer_camera_invalid");
    }
    return {
      kind: "3d",
      yaw: finite(record.yaw, -180, 180, "r1_viewer_camera_invalid"),
      pitch: finite(record.pitch, -89, 89, "r1_viewer_camera_invalid"),
      zoom: finite(record.zoom, 0.1, 20, "r1_viewer_camera_invalid"),
      target: [
        finite(record.target[0], -1_000_000, 1_000_000, "r1_viewer_camera_invalid"),
        finite(record.target[1], -1_000_000, 1_000_000, "r1_viewer_camera_invalid"),
        finite(record.target[2], -1_000_000, 1_000_000, "r1_viewer_camera_invalid"),
      ],
    };
  }

  exactKeys(record, ["kind", "page", "rotation", "zoom", "pan"], "r1_viewer_camera_invalid");
  if (record.kind !== "2d" || !Array.isArray(record.pan) || record.pan.length !== 2
    || Object.hasOwn(record, "yaw") || Object.hasOwn(record, "pitch") || Object.hasOwn(record, "target")) {
    throw new Error("r1_viewer_camera_invalid");
  }
  const page = record.page === null ? null : finite(record.page, 1, 10_000, "r1_viewer_camera_invalid");
  if ((format === "pdf" && (!Number.isSafeInteger(page) || page === null)) || (format === "png" && page !== null)) {
    throw new Error("r1_viewer_camera_invalid");
  }
  if (![0, 90, 180, 270].includes(record.rotation as number)) throw new Error("r1_viewer_camera_invalid");
  return {
    kind: "2d",
    page,
    rotation: record.rotation as 0 | 90 | 180 | 270,
    zoom: finite(record.zoom, 0.1, 20, "r1_viewer_camera_invalid"),
    pan: [
      finite(record.pan[0], -1_000_000, 1_000_000, "r1_viewer_camera_invalid"),
      finite(record.pan[1], -1_000_000, 1_000_000, "r1_viewer_camera_invalid"),
    ],
  };
}

function parseRegion(value: unknown): R1ViewerRegion | null {
  if (value === null) return null;
  const record = strictRecord(value, ["x", "y", "width", "height"], "r1_viewer_region_invalid");
  exactKeys(record, ["x", "y", "width", "height"], "r1_viewer_region_invalid");
  const region = {
    x: finite(record.x, 0, 1, "r1_viewer_region_invalid"),
    y: finite(record.y, 0, 1, "r1_viewer_region_invalid"),
    width: finite(record.width, 0.000001, 1, "r1_viewer_region_invalid"),
    height: finite(record.height, 0.000001, 1, "r1_viewer_region_invalid"),
  };
  if (region.width > 1 - region.x || region.height > 1 - region.y) {
    throw new Error("r1_viewer_region_invalid");
  }
  return region;
}

function parseSelection(value: unknown, representationDigest: string): R1ViewerState["selection"] {
  if (value === null) return null;
  const record = strictRecord(
    value,
    ["objectId", "representationDigest", "region"],
    "r1_viewer_selection_invalid",
  );
  exactKeys(record, ["objectId", "representationDigest", "region"], "r1_viewer_selection_invalid");
  if (typeof record.objectId !== "string" || !OPAQUE_ID.test(record.objectId)
    || typeof record.representationDigest !== "string"
    || !DIGEST.test(record.representationDigest)
    || record.representationDigest !== representationDigest) {
    throw new Error("r1_viewer_selection_invalid");
  }
  return {
    objectId: record.objectId,
    representationDigest,
    region: parseRegion(record.region),
  };
}

export function validateR1ViewerState(input: unknown): R1ViewerState {
  const record = strictRecord(
    input,
    ["contractVersion", "scope", "representation", "access", "camera", "selection"],
    "r1_viewer_state_invalid",
  );
  exactKeys(record, ["contractVersion", "scope", "representation", "access", "camera", "selection"], "r1_viewer_state_invalid");
  if (record.contractVersion !== R1_VIEWER_STATE_VERSION) throw new Error("r1_viewer_state_invalid");

  const scope = parseScope(record.scope);
  const representation = parseRepresentation(record.representation);
  const access = parseAccess(record.access);
  const camera = parseCamera(record.camera, representation.format);
  const selection = parseSelection(record.selection, representation.digest);
  const revoked = access.lifecycle === "revoked";
  const superseded = representation.status === "superseded";

  return {
    contractVersion: R1_VIEWER_STATE_VERSION,
    scope,
    representation,
    access,
    camera,
    selection,
    presentation: {
      historical: superseded,
      warning: revoked ? "access_revoked" : superseded ? "superseded_history" : "none",
      byteRequestDisposition: revoked ? "deny_revoked" : "broker_authorization_required",
      newDispatchCandidate: representation.status === "current" && !revoked,
    },
    deliveryRequirements: {
      cacheControl: "private, no-store",
      requireBrokerAuthorizationPerRequest: true,
      maximumRangeReauthorizationIntervalMs: 1000,
      prohibitRawStorageLocator: true,
    },
  };
}

export const resetR1ViewerCamera = (): R1ViewerCamera3d => ({
  kind: "3d",
  yaw: 0,
  pitch: 0,
  zoom: 1,
  target: [0, 0, 0],
});
