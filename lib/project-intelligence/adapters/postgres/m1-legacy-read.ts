import type { PostgresRpcClient } from "./contracts";
import { ProjectIntelligenceAdapterError } from "./errors";
import { callRpc } from "./rpc";

export const M1_LEGACY_READ_CONTRACT_VERSION =
  "project-ceo-m1-legacy-read/0.1" as const;

export interface M1LegacyPassportRevision {
  readonly projectId: string;
  readonly revisionNo: number;
  readonly passport: Readonly<Record<string, unknown>>;
  readonly llmOk: boolean;
  readonly createdAt: string;
}

export interface M1LegacyContractDocument {
  readonly documentId: string;
  readonly status: "uploaded" | "received" | "signed" | "archived";
  readonly createdAt: string;
  readonly statusUpdatedAt: string | null;
}

export interface M1LegacyReadScope {
  readonly accessScope: "project";
  readonly actorUserId: string;
  readonly organizationId: string;
  readonly packageId: null;
  readonly projectId: string;
}

export interface M1LegacyProjectRead {
  readonly contractVersion: typeof M1_LEGACY_READ_CONTRACT_VERSION;
  readonly requestId: string;
  readonly scope: M1LegacyReadScope;
  readonly stateRevision: number;
  readonly data: {
    readonly passportRevision: M1LegacyPassportRevision | null;
    readonly contractDocument: M1LegacyContractDocument | null;
  };
  readonly error: null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parsePassport(value: unknown): M1LegacyPassportRevision | null {
  if (value === null) return null;
  if (!isRecord(value)
    || !isUuid(value.projectId)
    || !isRevision(value.revisionNo)
    || !isRecord(value.passport)
    || typeof value.llmOk !== "boolean"
    || !isTimestamp(value.createdAt)) return null;
  return {
    projectId: value.projectId,
    revisionNo: value.revisionNo,
    passport: value.passport,
    llmOk: value.llmOk,
    createdAt: value.createdAt,
  };
}

function parseContract(value: unknown): M1LegacyContractDocument | null {
  if (value === null) return null;
  if (!isRecord(value)
    || !isUuid(value.documentId)
    || (value.status !== "uploaded" && value.status !== "received"
      && value.status !== "signed" && value.status !== "archived")
    || !isTimestamp(value.createdAt)
    || (value.statusUpdatedAt !== null && !isTimestamp(value.statusUpdatedAt))) return null;
  return {
    documentId: value.documentId,
    status: value.status,
    createdAt: value.createdAt,
    statusUpdatedAt: value.statusUpdatedAt,
  };
}

export function parseM1LegacyProjectRead(value: unknown): M1LegacyProjectRead {
  if (!isRecord(value)
    || value.contractVersion !== M1_LEGACY_READ_CONTRACT_VERSION
    || typeof value.requestId !== "string"
    || !isRecord(value.scope)
    || value.scope.accessScope !== "project"
    || !isUuid(value.scope.actorUserId)
    || !isUuid(value.scope.organizationId)
    || value.scope.packageId !== null
    || !isUuid(value.scope.projectId)
    || !isRevision(value.stateRevision)
    || !isRecord(value.data)
    || !isRecord(value.data.passportRevision) && value.data.passportRevision !== null
    || !isRecord(value.data.contractDocument) && value.data.contractDocument !== null
    || value.error !== null) {
    throw new ProjectIntelligenceAdapterError("internal_error", null);
  }
  const passportRevision = parsePassport(value.data.passportRevision);
  const contractDocument = parseContract(value.data.contractDocument);
  if (value.data.passportRevision !== null && passportRevision === null
    || value.data.contractDocument !== null && contractDocument === null) {
    throw new ProjectIntelligenceAdapterError("internal_error", null);
  }
  return {
    contractVersion: M1_LEGACY_READ_CONTRACT_VERSION,
    requestId: value.requestId,
    scope: {
      accessScope: "project",
      actorUserId: value.scope.actorUserId,
      organizationId: value.scope.organizationId,
      packageId: null,
      projectId: value.scope.projectId,
    },
    stateRevision: value.stateRevision,
    data: { passportRevision, contractDocument },
    error: null,
  };
}

export class ProjectCeoM1LegacyReadPostgresAdapter {
  constructor(private readonly client: PostgresRpcClient) {}

  async getM1LegacyProjectRead(input: {
    readonly projectId: string;
  }): Promise<M1LegacyProjectRead> {
    return parseM1LegacyProjectRead(await callRpc(
      this.client,
      "projectceo_read_api",
      "get_m1_legacy_project_read",
      { project_id: input.projectId },
    ));
  }
}
