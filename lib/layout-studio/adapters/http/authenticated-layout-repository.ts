import {
  diffLayoutDocuments,
  semanticHash,
  validateLayoutDocument,
  type LayoutDocument,
  type LayoutDocumentDiff,
} from "@/lib/layout-studio/domain";
import type {
  LayoutRepository,
  LayoutVersion,
  VersionPublicationInput,
} from "@/lib/layout-studio/application/layout-repository";

const READ_CONTRACT = "project-ceo-authenticated-read/0.1";
const COMMAND_CONTRACT = "projectceo-command/0.1";
const LAYOUT_SCHEMA = "project-ceo-m2-layout/0.1";
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type VariantRole = "preferred" | "value_engineered" | "premium";

interface RepositoryContext {
  projectId: string;
  packageId: string;
  roomId: string;
  variantId: string;
  role: VariantRole;
}

interface AuthenticatedLayoutRepositoryOptions {
  fetch: typeof fetch;
  randomUUID: () => string;
  context: RepositoryContext;
}

interface LayoutRowPayload {
  versionId: string;
  roomId: string;
  variantId: string;
  role: VariantRole;
  semanticHash: string;
  schemaVersion: typeof LAYOUT_SCHEMA;
  layoutContent: LayoutDocument;
}

interface LayoutRow {
  id: string;
  documentId: string;
  versionId: string;
  packageId: string;
  revisionId: string;
  revisionNo: number;
  semanticHash: string;
  roomId: string;
  variantId: string;
  role: VariantRole;
  schemaVersion: typeof LAYOUT_SCHEMA;
  status: "published";
  payload: LayoutRowPayload;
  createdAt: string;
}

export class LayoutRepositoryError extends Error {
  constructor(public readonly code: string, message = code) {
    super(message);
    this.name = "LayoutRepositoryError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function malformed(message: string): never {
  throw new LayoutRepositoryError("MALFORMED_RESPONSE", message);
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) malformed(`Invalid ${name}`);
  return value;
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return malformed("Response is not valid JSON");
  }
}

function mapHttpError(status: number): string {
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 403) return "FORBIDDEN";
  if (status === 409) return "STALE_STATE";
  return "REQUEST_FAILED";
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class AuthenticatedLayoutRepository implements LayoutRepository {
  private readonly fetchImpl: typeof fetch;
  private readonly randomUUID: () => string;
  private readonly context: RepositoryContext;

  constructor(options: AuthenticatedLayoutRepositoryOptions) {
    if (
      !UUID_PATTERN.test(options.context.projectId) ||
      !UUID_PATTERN.test(options.context.packageId)
    ) {
      throw new LayoutRepositoryError("INVALID_CONTEXT", "Project and package IDs must be UUIDs");
    }
    this.fetchImpl = options.fetch;
    this.randomUUID = options.randomUUID;
    this.context = clone(options.context);
  }

  async publishVersion(
    document: LayoutDocument,
    input: VersionPublicationInput,
  ): Promise<LayoutVersion> {
    this.assertDocumentScope(document);
    const validation = validateLayoutDocument(document);
    if (!validation.valid) {
      throw new LayoutRepositoryError("INVALID_LAYOUT", "Layout document is invalid");
    }

    const currentVersions = await this.readVersions();
    const current = currentVersions
      .filter((version) => version.documentId === document.documentId)
      .sort((left, right) => right.revisionNo - left.revisionNo)[0];
    if (
      (current !== undefined && input.parentVersionId !== current.versionId) ||
      (current === undefined && input.parentVersionId !== undefined)
    ) {
      throw new LayoutRepositoryError("STALE_STATE", "Parent version is not the latest server version");
    }

    const commandId = this.nextUUID("commandId");
    const revisionId = this.nextUUID("revisionId");
    const content = clone(document);
    const hash = `sha256:${await semanticHash(content)}`;
    const response = await this.fetchImpl("/api/projectceo/commands", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contractVersion: COMMAND_CONTRACT,
        commandId,
        projectId: this.context.projectId,
        kind: "publish_m2_layout_version",
        payload: {
          packageId: this.context.packageId,
          documentId: content.documentId,
          versionId: input.versionId,
          revisionId,
          expectedRevisionId: current?.revisionId ?? null,
          roomId: this.context.roomId,
          variantId: this.context.variantId,
          role: this.context.role,
          semanticHash: hash,
          schemaVersion: LAYOUT_SCHEMA,
          layoutContent: content,
          reason: input.reason,
        },
      }),
    });
    if (!response.ok) {
      throw new LayoutRepositoryError(mapHttpError(response.status));
    }
    const body = await parseJson(response);
    this.assertPublishResponse(body, revisionId, content.documentId);
    const authoritative = (await this.readVersions()).find(
      (version) => version.revisionId === revisionId,
    );
    if (!authoritative) return malformed("Published revision is absent from authoritative read");
    return clone(authoritative);
  }

  async loadVersion(versionId: string): Promise<LayoutVersion | null> {
    const versions = await this.readVersions();
    const version = versions.find((candidate) => candidate.versionId === versionId);
    return version ? clone(version) : null;
  }

  async listVersions(documentId: string): Promise<LayoutVersion[]> {
    return (await this.readVersions())
      .filter((version) => version.documentId === documentId)
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.versionId.localeCompare(right.versionId),
      )
      .map(clone);
  }

  async diffVersions(fromVersionId: string, toVersionId: string): Promise<LayoutDocumentDiff> {
    const versions = await this.readVersions();
    const from = versions.find((version) => version.versionId === fromVersionId);
    const to = versions.find((version) => version.versionId === toVersionId);
    if (!from || !to) {
      throw new LayoutRepositoryError("VERSION_NOT_FOUND", "Requested version was not found");
    }
    return diffLayoutDocuments(fromVersionId, from.content, toVersionId, to.content);
  }

  private async readVersions(): Promise<LayoutVersion[]> {
    const response = await this.fetchImpl(
      `/api/projectceo/projects/${encodeURIComponent(this.context.projectId)}/layouts?packageId=${encodeURIComponent(this.context.packageId)}`,
      { method: "GET", credentials: "same-origin", cache: "no-store" },
    );
    if (!response.ok) throw new LayoutRepositoryError(mapHttpError(response.status));
    const body = await parseJson(response);
    if (
      !isRecord(body) ||
      !hasExactKeys(body, ["contractVersion", "requestId", "data", "error", "scope", "stateRevision"]) ||
      body.contractVersion !== READ_CONTRACT ||
      body.error !== null ||
      typeof body.requestId !== "string" ||
      body.requestId.length === 0 ||
      !Number.isSafeInteger(body.stateRevision) ||
      Number(body.stateRevision) < 0
    ) {
      return malformed("Invalid authenticated read envelope");
    }
    if (
      !isRecord(body.scope) ||
      !hasExactKeys(body.scope, [
        "accessScope", "actorUserId", "organizationId", "packageId", "projectId",
      ])
    ) return malformed("Missing authenticated scope");
    const scope = body.scope;
    if (
      scope.accessScope !== "package" ||
      scope.projectId !== this.context.projectId ||
      scope.packageId !== this.context.packageId ||
      typeof scope.actorUserId !== "string" ||
      !UUID_PATTERN.test(scope.actorUserId) ||
      typeof scope.organizationId !== "string" ||
      !UUID_PATTERN.test(scope.organizationId)
    ) {
      return malformed("Authenticated read scope does not match repository context");
    }
    if (
      !isRecord(body.data) ||
      !hasExactKeys(body.data, ["m2LayoutVersions"]) ||
      !Array.isArray(body.data.m2LayoutVersions)
    ) {
      return malformed("Missing layout version projection");
    }
    const versions: LayoutVersion[] = [];
    const revisionIds = new Set<string>();
    const versionIds = new Set<string>();
    for (const value of body.data.m2LayoutVersions) {
      const row = await this.parseRow(value);
      if (revisionIds.has(row.revisionId) || versionIds.has(row.versionId)) {
        return malformed("Duplicate immutable layout identity");
      }
      revisionIds.add(row.revisionId);
      versionIds.add(row.versionId);
      if (
        row.roomId === this.context.roomId &&
        row.variantId === this.context.variantId &&
        row.role === this.context.role
      ) {
        versions.push(this.toVersion(row));
      }
    }
    return versions;
  }

  private async parseRow(value: unknown): Promise<LayoutRow> {
    if (!isRecord(value) || !hasExactKeys(value, [
      "id", "documentId", "versionId", "packageId", "revisionId", "revisionNo",
      "semanticHash", "roomId", "variantId", "role", "schemaVersion", "status",
      "payload", "createdAt",
    ])) return malformed("Invalid layout row shape");
    if (!isRecord(value.payload) || !hasExactKeys(value.payload, [
      "versionId", "roomId", "variantId", "role", "semanticHash", "schemaVersion", "layoutContent",
    ])) return malformed("Invalid layout payload shape");

    const payload = value.payload;
    const role = value.role;
    if (role !== "preferred" && role !== "value_engineered" && role !== "premium") {
      return malformed("Invalid layout variant role");
    }
    if (
      value.packageId !== this.context.packageId ||
      value.status !== "published" ||
      !Number.isSafeInteger(value.revisionNo) || Number(value.revisionNo) < 1 ||
      value.documentId !== value.id ||
      value.versionId !== payload.versionId ||
      value.semanticHash !== payload.semanticHash ||
      value.roomId !== payload.roomId ||
      value.variantId !== payload.variantId ||
      role !== payload.role ||
      value.schemaVersion !== payload.schemaVersion ||
      value.schemaVersion !== LAYOUT_SCHEMA ||
      typeof value.semanticHash !== "string" || !HASH_PATTERN.test(value.semanticHash) ||
      !isRecord(payload.layoutContent)
    ) return malformed("Layout row is outside the exact repository contract");

    const content = payload.layoutContent as unknown as LayoutDocument;
    if (
      content.projectId !== this.context.projectId ||
      content.documentId !== value.documentId ||
      content.variant?.id !== value.variantId ||
      content.variant?.status !== "published"
    ) {
      return malformed("Layout row document identity does not match its content");
    }
    if (!validateLayoutDocument(content).valid) return malformed("Invalid layout document");
    const calculated = `sha256:${await semanticHash(content)}`;
    if (calculated !== payload.semanticHash) return malformed("Layout semantic hash mismatch");

    return {
      id: requireString(value.id, "id"),
      documentId: requireString(value.documentId, "documentId"),
      versionId: requireString(value.versionId, "versionId"),
      packageId: requireString(value.packageId, "packageId"),
      revisionId: requireString(value.revisionId, "revisionId"),
      revisionNo: value.revisionNo as number,
      semanticHash: value.semanticHash,
      roomId: requireString(value.roomId, "roomId"),
      variantId: requireString(value.variantId, "variantId"),
      role,
      schemaVersion: LAYOUT_SCHEMA,
      status: "published",
      createdAt: requireString(value.createdAt, "createdAt"),
      payload: {
        versionId: requireString(payload.versionId, "versionId"),
        roomId: requireString(payload.roomId, "payload.roomId"),
        variantId: requireString(payload.variantId, "payload.variantId"),
        role,
        semanticHash: payload.semanticHash,
        schemaVersion: LAYOUT_SCHEMA,
        layoutContent: clone(content),
      },
    };
  }

  private toVersion(row: LayoutRow): LayoutVersion {
    return {
      versionId: row.payload.versionId,
      documentId: row.id,
      revisionId: row.revisionId,
      revisionNo: row.revisionNo,
      createdAt: row.createdAt,
      semanticHash: row.payload.semanticHash,
      content: clone(row.payload.layoutContent),
    };
  }

  private assertDocumentScope(document: LayoutDocument): void {
    if (
      document.projectId !== this.context.projectId ||
      document.documentId.length === 0 ||
      document.variant?.id !== this.context.variantId ||
      document.variant?.status !== "published"
    ) {
      throw new LayoutRepositoryError("SCOPE_MISMATCH", "Layout does not match repository context");
    }
  }

  private assertPublishResponse(body: unknown, revisionId: string, documentId: string): void {
    if (
      !isRecord(body) ||
      !hasExactKeys(body, [
        "contractVersion", "requestId", "status", "operation", "replay", "stateRevision", "result",
      ]) ||
      body.contractVersion !== COMMAND_CONTRACT ||
      body.status !== "completed" ||
      body.operation !== "append_m2_layout_version_revision" ||
      typeof body.requestId !== "string" ||
      body.requestId.length === 0 ||
      typeof body.replay !== "boolean" ||
      !Number.isSafeInteger(body.stateRevision) ||
      Number(body.stateRevision) < 0
    ) {
      return malformed("Invalid command response envelope");
    }
    if (
      !isRecord(body.result) ||
      !hasExactKeys(body.result, [
        "entityKind", "entityId", "revisionId", "revisionNo", "packageId", "status",
      ])
    ) return malformed("Missing command result");
    if (
      body.result.entityKind !== "layout_version" ||
      body.result.entityId !== documentId ||
      body.result.revisionId !== revisionId ||
      body.result.packageId !== this.context.packageId ||
      body.result.status !== "published" ||
      !Number.isSafeInteger(body.result.revisionNo) ||
      Number(body.result.revisionNo) < 1
    ) return malformed("Command response does not match publication");
  }

  private nextUUID(name: string): string {
    const value = this.randomUUID();
    if (!UUID_PATTERN.test(value)) {
      throw new LayoutRepositoryError("INVALID_IDENTIFIER", `${name} must be a UUID`);
    }
    return value;
  }
}
