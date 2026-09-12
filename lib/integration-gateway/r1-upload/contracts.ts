import { z } from "zod";
import { ProjectIntelligenceAdapterError } from "@/lib/project-intelligence/adapters/postgres/errors";
import { R1_UPLOAD_FORMATS, R1_VALIDATION_PROFILES, r1UploadFormatPolicy } from "./formats";

export const R1_UPLOAD_LIMITS = Object.freeze({
  jsonBytes: 16 * 1024,
  sessionLifetimeMs: 30 * 60 * 1000,
  grantLifetimeMs: 5 * 60 * 1000,
  partBytes: 8_000_000,
  maxParts: 13,
});

const uuid = z.string().uuid();
const safePositive = z.number().int().positive().safe();
const projectionRevision = z.number().int().nonnegative().safe();
const commandRevision = projectionRevision.max(Number.MAX_SAFE_INTEGER - 1);
// Check controls before trim so leading/trailing C0 bytes cannot disappear.
const idempotencyKey = z.string().regex(/^[^\u0000-\u001f\u007f]*$/u).trim().min(1).max(512);
const format = z.enum(R1_UPLOAD_FORMATS);
const sessionCommand = {
  sessionId: uuid,
  expectedRevision: commandRevision,
  idempotencyKey,
};

export const beginExternalUploadSchema = z.object({
  packageId: uuid,
  format,
  declaredByteLength: safePositive,
  idempotencyKey,
  displayFilename: z.string().trim().min(1).max(500).regex(/^[^/\\\u0000-\u001f\u007f]+$/u).optional(),
}).strict().superRefine((input, ctx) => {
  if (input.declaredByteLength > r1UploadFormatPolicy(input.format).maxBytes) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["declaredByteLength"], message: "format_size_limit" });
  }
});

// No storage claim is needed from the browser: the adapter inspects the session's object.
export const finalizeExternalUploadSchema = z.object(sessionCommand).strict();
export const cancelExternalUploadSchema = z.object(sessionCommand).strict();
export const resumeExternalUploadSchema = z.object({
  ...sessionCommand,
  partNumbers: z.array(safePositive.max(R1_UPLOAD_LIMITS.maxParts)).min(1).max(R1_UPLOAD_LIMITS.maxParts),
}).strict().superRefine((input, ctx) => {
  if (new Set(input.partNumbers).size !== input.partNumbers.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["partNumbers"], message: "duplicate_part" });
  }
});

export type BeginExternalUpload = z.infer<typeof beginExternalUploadSchema>;
export type FinalizeExternalUpload = z.infer<typeof finalizeExternalUploadSchema>;
export type ResumeExternalUpload = z.infer<typeof resumeExternalUploadSchema>;
export type CancelExternalUpload = z.infer<typeof cancelExternalUploadSchema>;

/** Avoid returning Zod input/path diagnostics through the public envelope. */
export function parseExternalUploadCommand<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ProjectIntelligenceAdapterError("validation_failed", null, "upload_command_invalid");
  return parsed.data;
}

export const externalUploadProjectionSchema = z.object({
  sessionId: uuid,
  intakeId: uuid,
  packageId: uuid,
  assetVersionId: uuid.optional(),
  format,
  byteLength: safePositive.optional(),
  validationProfile: z.enum(R1_VALIDATION_PROFILES).optional(),
  status: z.enum(["open", "finalizing", "finalized", "cancelled", "expired", "failed", "validating", "clean", "human_reviewed", "infected", "scan_failed"]),
  revision: projectionRevision,
  expiresAt: z.string().datetime().optional(),
  failureCode: z.enum(["validation_failed", "forbidden", "expired", "revoked", "internal_error"]).optional(),
}).strict();
export type ExternalUploadProjection = z.infer<typeof externalUploadProjectionSchema>;
