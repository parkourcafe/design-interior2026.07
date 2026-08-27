import { describe, expect, it } from "vitest";
import type { ConnectionRef, RequestActorContext } from "../core/connector";
import { GoogleDriveSelectedImportWorker, type GoogleDriveImportPorts } from "./import-worker";

const actor: RequestActorContext = {
  actorId: "user-1",
  organizationId: "org-1",
  projectId: "project-1",
  correlationId: "corr-1",
  effectiveCapabilities: ["register_source"],
};
const connection: ConnectionRef = {
  connectionId: "connection-1",
  provider: "google_drive",
  organizationId: "org-1",
};
const selected = {
  opaqueKey: "opaque-drive-pdf",
  kind: "file" as const,
  displayName: "plan.pdf",
  mimeType: "application/pdf",
  sizeBytes: 9,
  revision: "etag-1",
  modifiedAt: "2026-08-26T00:00:00.000Z",
};

function createPorts(outcome: "clean" | "infected" | "scan_failed" = "clean") {
  const calls: string[] = [];
  const ports: GoogleDriveImportPorts = {
    downloadSelectedObject: async (input) => {
      calls.push("download");
      expect(input.selected).toEqual(selected);
      return {
        selected,
        bytes: new TextEncoder().encode("%PDF-1.7\n"),
        filename: "plan.pdf",
        providerMediaType: "application/pdf",
      };
    },
    upsertExternalObject: async (input) => {
      calls.push("external");
      expect(input.externalRevision).toBe("etag-1");
      expect(input.metadata).toEqual({
        selectionMode: "explicit_selected_object",
        provider: "google_drive",
      });
      return { externalObjectId: "external-1" };
    },
    createQuarantine: async (input) => {
      calls.push("quarantine");
      expect(input.upload.checksumHex).toMatch(/^[a-f0-9]{64}$/u);
      return { intakeId: "intake-1" };
    },
    scan: async () => {
      calls.push("scan");
      return { outcome };
    },
    completeScan: async (input) => {
      calls.push(`complete:${input.outcome}`);
    },
    createCandidate: async (input) => {
      calls.push("candidate");
      expect(input.exactExternalRevision).toBe("etag-1");
      expect(input.serverSha256).toMatch(/^[a-f0-9]{64}$/u);
      return { candidateId: "candidate-1" };
    },
  };
  return { ports, calls };
}

describe("Google Drive selected-object import worker", () => {
  it("runs selected PDF through quarantine, clean scan, checksum and candidate", async () => {
    const harness = createPorts();
    const result = await new GoogleDriveSelectedImportWorker(harness.ports).importSelectedObject({
      actor,
      connection,
      projectId: "project-1",
      projectConnectionId: "project-connection-1",
      selected,
      sourceRole: "document",
      idempotencyKey: "import-1",
    });
    expect(result).toEqual({
      state: "candidate",
      candidateId: "candidate-1",
      intakeId: "intake-1",
      externalObjectId: "external-1",
      exactExternalRevision: "etag-1",
      serverSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(harness.calls).toEqual([
      "download",
      "external",
      "quarantine",
      "scan",
      "complete:clean",
      "candidate",
    ]);
    expect(JSON.stringify(result)).not.toContain("opaque-drive-pdf");
    expect(JSON.stringify(result)).not.toContain("plan.pdf");
  });

  it("does not create a candidate after an infected scan", async () => {
    const harness = createPorts("infected");
    const result = await new GoogleDriveSelectedImportWorker(harness.ports).importSelectedObject({
      actor,
      connection,
      projectId: "project-1",
      projectConnectionId: "project-connection-1",
      selected,
      sourceRole: "document",
      idempotencyKey: "import-infected",
    });
    expect(result).toEqual({
      state: "rejected",
      intakeId: "intake-1",
      exactExternalRevision: "etag-1",
      scanOutcome: "infected",
    });
    expect(harness.calls).toEqual([
      "download",
      "external",
      "quarantine",
      "scan",
      "complete:infected",
    ]);
  });

  it("rejects provider metadata that changes the selected exact revision", async () => {
    const harness = createPorts();
    harness.ports.downloadSelectedObject = async () => ({
      selected: { ...selected, revision: "etag-2" },
      bytes: new TextEncoder().encode("%PDF-1.7\n"),
      filename: "plan.pdf",
      providerMediaType: "application/pdf",
    });
    await expect(new GoogleDriveSelectedImportWorker(harness.ports).importSelectedObject({
      actor,
      connection,
      projectId: "project-1",
      projectConnectionId: "project-connection-1",
      selected,
      sourceRole: "document",
      idempotencyKey: "import-revision-mismatch",
    })).rejects.toThrow("revision_mismatch");
    expect(harness.calls).toEqual([]);
  });

  it("rejects downloaded bytes or metadata that no longer match the explicit selection", async () => {
    const harness = createPorts();
    harness.ports.downloadSelectedObject = async () => ({
      selected: { ...selected, sizeBytes: 8 },
      bytes: new TextEncoder().encode("%PDF-1.7\n"),
      filename: "plan.pdf",
      providerMediaType: "application/pdf",
    });
    await expect(new GoogleDriveSelectedImportWorker(harness.ports).importSelectedObject({
      actor,
      connection,
      projectId: "project-1",
      projectConnectionId: "project-connection-1",
      selected,
      sourceRole: "document",
      idempotencyKey: "import-metadata-mismatch",
    })).rejects.toThrow("metadata_mismatch");
    expect(harness.calls).toEqual([]);
  });

  it("rejects a connection or project from another server-side scope", async () => {
    const harness = createPorts();
    await expect(new GoogleDriveSelectedImportWorker(harness.ports).importSelectedObject({
      actor,
      connection: { ...connection, organizationId: "other-org" },
      projectId: "project-1",
      projectConnectionId: "project-connection-1",
      selected,
      sourceRole: "document",
      idempotencyKey: "import-scope-mismatch",
    })).rejects.toThrow("google_drive_import_scope_mismatch");
    expect(harness.calls).toEqual([]);
  });
});
