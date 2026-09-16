import { z } from "zod";
import { r1PdfDeclaredGeometrySchema, R1_PDF_FALLBACK_WARNING } from "../../delivery/projectceo/r1-pdf-fallback-contract";

export const sidecarResultSchema = z.object({
  sidecarId: z.string().uuid(), schemaVersion: z.literal("r1-pdf-sheet-sidecar/1"),
  confirmationId: z.string().uuid(), sheetId: z.string().min(1).max(160), sheetRevisionId: z.string().min(1).max(160),
  pdfAssetVersionId: z.string().uuid(), pdfSha256: z.string().regex(/^[0-9a-f]{64}$/),
  geometryEvidence: z.literal("architect_declared"), pageMetadataVerification: z.literal("not_verified"),
  createdAt: z.string().datetime(), conversionStatus: z.literal("unconfirmed"), warning: z.literal(R1_PDF_FALLBACK_WARNING),
  ...r1PdfDeclaredGeometrySchema.innerType().shape,
}).strict().superRefine((value, context) => {
  const checked = r1PdfDeclaredGeometrySchema.safeParse({pdfPageIndex:value.pdfPageIndex,pdfCrop:value.pdfCrop,rotationDegrees:value.rotationDegrees,units:value.units,pageToPreviewTransform:value.pageToPreviewTransform});
  if (!checked.success) for (const issue of checked.error.issues) context.addIssue(issue);
});
