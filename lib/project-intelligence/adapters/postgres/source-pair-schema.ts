import { z } from "zod";

export const sourcePairResultSchema = z.object({
    confirmationId: z.string().uuid(),
    schemaVersion: z.literal("r1-source-pair-confirmation/1"),
    dwgAssetVersionId: z.string().uuid(), pdfAssetVersionId: z.string().uuid(),
    dwgRevision: z.number().int().positive().safe(), pdfRevision: z.number().int().positive().safe(),
    dwgSha256: z.string().regex(/^[0-9a-f]{64}$/), pdfSha256: z.string().regex(/^[0-9a-f]{64}$/),
    confirmedAt: z.string().datetime(),
    confirmationStatus: z.literal("architect_confirmed"), conversionStatus: z.literal("unconfirmed"),
    warning: z.literal("PDF предоставлен архитектором; DWG conversion не подтверждён"),
}).strict();
