import { createHash } from "node:crypto";
import type {
  ConnectionRef,
  RequestActorContext,
} from "../core/connector";
import {
  validateFileIntakeUpload,
  type FileIntakeSourceRole,
  type ValidatedFileIntakeUpload,
} from "../file-intake/policy";
import {
  assertGoogleDriveImportableFile,
  GoogleDrivePolicyError,
  type GoogleDriveSelectedObject,
} from "./policy";

export interface GoogleDriveDownloadedObject {
  readonly selected: GoogleDriveSelectedObject;
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly providerMediaType: string;
}

function normalizedMimeType(value: string): string {
  return value.trim().toLowerCase();
}

export interface GoogleDriveImportPorts {
  downloadSelectedObject(input: {
    readonly actor: RequestActorContext;
    readonly connection: ConnectionRef;
    readonly projectConnectionId: string;
    readonly selected: GoogleDriveSelectedObject;
  }): Promise<GoogleDriveDownloadedObject>;
  upsertExternalObject(input: {
    readonly projectConnectionId: string;
    readonly providerObjectKey: string;
    readonly providerObjectHashHex: string;
    readonly objectKind: "file";
    readonly displayName: string;
    readonly mimeType: string;
    readonly sizeBytes: number;
    readonly externalRevision: string;
    readonly modifiedAtProvider: string | null;
    readonly metadata: Record<string, unknown>;
    readonly idempotencyKey: string;
  }): Promise<{ readonly externalObjectId: string }>;
  createQuarantine(input: {
    readonly projectId: string;
    readonly upload: ValidatedFileIntakeUpload;
    readonly idempotencyKey: string;
  }): Promise<{ readonly intakeId: string }>;
  completeScan(input: {
    readonly projectId: string;
    readonly intakeId: string;
    readonly outcome: "clean" | "infected" | "scan_failed";
    readonly idempotencyKey: string;
  }): Promise<void>;
  createCandidate(input: {
    readonly projectId: string;
    readonly externalObjectId: string;
    readonly intakeId: string;
    readonly exactExternalRevision: string;
    readonly serverSha256: string;
    readonly idempotencyKey: string;
  }): Promise<{ readonly candidateId: string }>;
  scan(input: {
    readonly bytes: Uint8Array;
    readonly checksumHex: string;
    readonly mediaType: string;
  }): Promise<{ readonly outcome: "clean" | "infected" | "scan_failed" }>;
}

export interface GoogleDriveSelectedImportInput {
  readonly actor: RequestActorContext;
  readonly connection: ConnectionRef;
  readonly projectId: string;
  readonly projectConnectionId: string;
  readonly selected: GoogleDriveSelectedObject;
  readonly sourceRole: FileIntakeSourceRole;
  readonly idempotencyKey: string;
}

export type GoogleDriveSelectedImportResult =
  | {
      readonly state: "candidate";
      readonly candidateId: string;
      readonly intakeId: string;
      readonly externalObjectId: string;
      readonly exactExternalRevision: string;
      readonly serverSha256: string;
    }
  | {
      readonly state: "rejected";
      readonly intakeId: string;
      readonly exactExternalRevision: string;
      readonly scanOutcome: "infected" | "scan_failed";
    };

function assertIdempotencyKey(value: string): string {
  const key = value.trim();
  if (key.length < 1 || key.length > 512) {
    throw new Error("google_drive_import_idempotency_invalid");
  }
  return key;
}

function assertDownloadedSelection(
  expected: GoogleDriveSelectedObject,
  downloaded: GoogleDriveDownloadedObject,
): GoogleDriveDownloadedObject {
  if (
    downloaded.selected.opaqueKey !== expected.opaqueKey
    || downloaded.selected.revision !== expected.revision
    || downloaded.selected.kind !== expected.kind
  ) {
    throw new GoogleDrivePolicyError("revision_mismatch");
  }
  if (
    downloaded.selected.displayName !== expected.displayName
    || normalizedMimeType(downloaded.selected.mimeType) !== normalizedMimeType(expected.mimeType)
    || downloaded.selected.sizeBytes !== expected.sizeBytes
    || downloaded.selected.modifiedAt !== expected.modifiedAt
    || downloaded.filename !== expected.displayName
    || normalizedMimeType(downloaded.providerMediaType) !== normalizedMimeType(expected.mimeType)
    || (expected.sizeBytes !== null && downloaded.bytes.byteLength !== expected.sizeBytes)
  ) {
    throw new GoogleDrivePolicyError("metadata_mismatch");
  }
  return downloaded;
}

export class GoogleDriveSelectedImportWorker {
  constructor(private readonly ports: GoogleDriveImportPorts) {}

  async importSelectedObject(
    input: GoogleDriveSelectedImportInput,
  ): Promise<GoogleDriveSelectedImportResult> {
    const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
    if (
      input.connection.provider !== "google_drive"
      || input.connection.organizationId !== input.actor.organizationId
      || (input.actor.projectId !== undefined && input.actor.projectId !== input.projectId)
    ) {
      throw new Error("google_drive_import_scope_mismatch");
    }
    const selected = assertGoogleDriveImportableFile(input.selected);
    const downloaded = assertDownloadedSelection(
      selected,
      await this.ports.downloadSelectedObject({
        actor: input.actor,
        connection: input.connection,
        projectConnectionId: input.projectConnectionId,
        selected,
      }),
    );
    const upload = validateFileIntakeUpload({
      bytes: downloaded.bytes,
      filename: downloaded.filename,
      browserMediaType: downloaded.providerMediaType,
      sourceRole: input.sourceRole,
    });
    const external = await this.ports.upsertExternalObject({
      projectConnectionId: input.projectConnectionId,
      providerObjectKey: selected.opaqueKey,
      providerObjectHashHex: createHash("sha256").update(selected.opaqueKey, "utf8").digest("hex"),
      objectKind: "file",
      displayName: selected.displayName,
      mimeType: upload.mediaType,
      sizeBytes: upload.sizeBytes,
      externalRevision: selected.revision,
      modifiedAtProvider: selected.modifiedAt,
      metadata: {
        selectionMode: "explicit_selected_object",
        provider: "google_drive",
      },
      idempotencyKey: `${idempotencyKey}:external-object`,
    });
    const intake = await this.ports.createQuarantine({
      projectId: input.projectId,
      upload,
      idempotencyKey: `${idempotencyKey}:quarantine`,
    });
    const scan = await this.ports.scan({
      bytes: upload.bytes,
      checksumHex: upload.checksumHex,
      mediaType: upload.mediaType,
    });
    await this.ports.completeScan({
      projectId: input.projectId,
      intakeId: intake.intakeId,
      outcome: scan.outcome,
      idempotencyKey: `${idempotencyKey}:scan`,
    });
    if (scan.outcome !== "clean") {
      return {
        state: "rejected",
        intakeId: intake.intakeId,
        exactExternalRevision: selected.revision,
        scanOutcome: scan.outcome,
      };
    }
    const candidate = await this.ports.createCandidate({
      projectId: input.projectId,
      externalObjectId: external.externalObjectId,
      intakeId: intake.intakeId,
      exactExternalRevision: selected.revision,
      serverSha256: upload.checksumHex,
      idempotencyKey: `${idempotencyKey}:candidate`,
    });
    return {
      state: "candidate",
      candidateId: candidate.candidateId,
      intakeId: intake.intakeId,
      externalObjectId: external.externalObjectId,
      exactExternalRevision: selected.revision,
      serverSha256: upload.checksumHex,
    };
  }
}
