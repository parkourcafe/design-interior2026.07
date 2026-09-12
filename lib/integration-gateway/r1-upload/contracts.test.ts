import { describe, expect, it } from "vitest";
import { errorEnvelope, ProjectIntelligenceAdapterError } from "@/lib/project-intelligence/adapters/postgres/errors";
import { FILE_INTAKE_MAX_BYTES } from "../file-intake/policy";
import {
  beginExternalUploadSchema, cancelExternalUploadSchema, finalizeExternalUploadSchema,
  resumeExternalUploadSchema, parseExternalUploadCommand, externalUploadProjectionSchema,
} from "./contracts";
import { R1_UPLOAD_FORMATS, r1UploadFormatPolicy } from "./formats";

const id = "00000000-0000-4000-8000-000000000001";
const begin = { packageId: id, format: "skp", declaredByteLength: 1, idempotencyKey: "request-1" };
const command = { sessionId: id, expectedRevision: 0, idempotencyKey: "request-2" };

describe("R1 upload browser contracts", () => {
  it.each(R1_UPLOAD_FORMATS)("accepts exactly the %s cap and rejects the next byte", (format) => {
    const cap = r1UploadFormatPolicy(format).maxBytes;
    expect(beginExternalUploadSchema.safeParse({ ...begin, format, declaredByteLength: cap }).success).toBe(true);
    expect(beginExternalUploadSchema.safeParse({ ...begin, format, declaredByteLength: cap + 1 }).success).toBe(false);
  });
  it.each(["actorId", "organizationId", "sourceRole", "approved", "bucket", "objectKey", "privateLocator", "checksumHex"])("rejects injected %s in every command", (field) => {
    for (const [schema, input] of [
      [beginExternalUploadSchema, begin], [finalizeExternalUploadSchema, command],
      [cancelExternalUploadSchema, command], [resumeExternalUploadSchema, { ...command, partNumbers: [1] }],
    ] as const) expect(schema.safeParse({ ...input, [field]: "untrusted" }).success).toBe(false);
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "100"])("rejects invalid length %s", (declaredByteLength) => {
    expect(beginExternalUploadSchema.safeParse({ ...begin, declaredByteLength }).success).toBe(false);
  });
  it("keeps optional names as safe display metadata and never uses them to select format", () => {
    expect(beginExternalUploadSchema.parse({ ...begin, displayFilename: "  example.pdf  " }).format).toBe("skp");
    for (const displayFilename of ["", "../x", "x/y", "x\\y", "x\u0000y", "x".repeat(501)]) {
      expect(beginExternalUploadSchema.safeParse({ ...begin, displayFilename }).success).toBe(false);
    }
    for (const format of ["zip", "dae", "csv", "xlsx", "SKP"]) {
      expect(beginExternalUploadSchema.safeParse({ ...begin, format }).success).toBe(false);
    }
  });
  it("requires bounded distinct part numbers, revision and idempotency", () => {
    for (const partNumbers of [[], [0], [14], [1, 1], [1.5]]) {
      expect(resumeExternalUploadSchema.safeParse({ ...command, partNumbers }).success).toBe(false);
    }
    expect(resumeExternalUploadSchema.parse({ ...command, partNumbers: [13, 1] }).partNumbers).toEqual([13, 1]);
    for (const expectedRevision of [-1, 1.1, Number.MAX_SAFE_INTEGER]) {
      expect(finalizeExternalUploadSchema.safeParse({ ...command, expectedRevision }).success).toBe(false);
    }
    expect(cancelExternalUploadSchema.safeParse({ ...command, idempotencyKey: " " }).success).toBe(false);
    expect(finalizeExternalUploadSchema.safeParse({ ...command, objectClaim: { objectKey: "x" } }).success).toBe(false);
  });
  it("uses existing stable errors without reflecting hostile input", () => {
    let failure: unknown;
    try { parseExternalUploadCommand(beginExternalUploadSchema, { ...begin, privateLocator: "private-test-path" }); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(ProjectIntelligenceAdapterError);
    const envelope = errorEnvelope("request-1", failure as ProjectIntelligenceAdapterError);
    expect(envelope.error?.code).toBe("validation_failed");
    expect(envelope.contractVersion).toBe("project-ceo-foundation/0.1");
    expect(JSON.stringify(envelope)).not.toContain("private-test-path");
    expect(JSON.stringify(envelope)).not.toContain("upload_command_invalid");
  });
  it("rejects server locator fields in browser projections", () => {
    const projection = { sessionId: id, intakeId: id, packageId: id, format: "skp", status: "open", revision: 0 };
    expect(externalUploadProjectionSchema.safeParse(projection).success).toBe(true);
    for (const key of ["privateLocator", "bucket", "signedUrl", "quarantineObjectKey", "result"]) {
      expect(externalUploadProjectionSchema.safeParse({ ...projection, [key]: "x" }).success).toBe(false);
    }
  });
  it("reuses legacy caps and makes retention distinct from viewable or approved geometry", () => {
    expect(r1UploadFormatPolicy("pdf").maxBytes).toBe(FILE_INTAKE_MAX_BYTES.pdf);
    expect(r1UploadFormatPolicy("png").maxBytes).toBe(FILE_INTAKE_MAX_BYTES.png);
    expect(r1UploadFormatPolicy("skp").purpose).toBe("original_retention");
    expect(r1UploadFormatPolicy("dwg").purpose).toBe("original_retention");
    expect(r1UploadFormatPolicy("glb").purpose).toBe("viewable_input");
    expect(r1UploadFormatPolicy("dae-package")).toMatchObject({ extension: "zip", sourceKind: "dae", purpose: "conversion_input" });
    for (const format of R1_UPLOAD_FORMATS) expect(r1UploadFormatPolicy(format).sourceRole).toBe("document");
  });
});
