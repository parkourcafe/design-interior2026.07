import { z } from "zod";

export const R1_PDF_FALLBACK_CONTRACT_VERSION = "r1-pdf-fallback/1" as const;
export const R1_PDF_FALLBACK_WARNING = "PDF предоставлен архитектором; DWG conversion не подтверждён" as const;

const uuid = z.string().uuid();
const finiteNumber = z.number().finite();
const unitInterval = finiteNumber.min(0).max(1);
const boundedIdentifier = z.string().trim().min(1).max(160);
const affineTransform = z.tuple([
  finiteNumber, finiteNumber, finiteNumber, finiteNumber, finiteNumber, finiteNumber,
]);

const crop = z.object({
  left: unitInterval,
  top: unitInterval,
  right: unitInterval,
  bottom: unitInterval,
}).strict().superRefine((value, context) => {
  if (value.left >= value.right || value.top >= value.bottom) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "pdf_crop_must_have_positive_area" });
  }
});

/**
 * Candidate metadata only. The server must resolve every ID inside the current
 * request scope, derive hashes/actor/package authority, and create the durable
 * pair attestation. This schema cannot assert an architect decision or DWG
 * conversion fidelity by itself.
 */
export const r1PdfFallbackCandidateSchema = z.object({
  contractVersion: z.literal(R1_PDF_FALLBACK_CONTRACT_VERSION),
  sourceDwgAssetVersionId: uuid,
  pdfAssetVersionId: uuid,
  representationVersionId: uuid,
  pairAttestationId: uuid,
  documentationSheetId: boundedIdentifier,
  documentationSheetRevisionId: boundedIdentifier,
  producer: z.literal("architect_provided"),
  conversionStatus: z.literal("unconfirmed"),
  pdfPageIndex: z.number().int().safe().nonnegative(),
  pdfCrop: crop,
  rotationDegrees: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  units: z.enum(["mm", "cm", "m"]),
  axes: z.enum(["z-up", "y-up"]),
  pageToPreviewTransform: affineTransform,
}).strict().superRefine((value, context) => {
  const [a, b, c, d, e, f] = value.pageToPreviewTransform;
  const determinant = a * d - b * c;
  const inverse = [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    -((d / determinant) * e + (-c / determinant) * f),
    -((-b / determinant) * e + (a / determinant) * f),
  ];
  const corners = [
    [value.pdfCrop.left, value.pdfCrop.top],
    [value.pdfCrop.left, value.pdfCrop.bottom],
    [value.pdfCrop.right, value.pdfCrop.top],
    [value.pdfCrop.right, value.pdfCrop.bottom],
  ] as const;
  const transformedCorners = corners.flatMap(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
  if (!Number.isFinite(determinant) || determinant === 0 || !inverse.every(Number.isFinite)
    || !transformedCorners.every(Number.isFinite)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "page_to_preview_transform_must_be_finite_and_invertible" });
  }
});

export type R1PdfFallbackCandidate = z.infer<typeof r1PdfFallbackCandidateSchema>;

export function parseR1PdfFallbackCandidate(input: unknown): R1PdfFallbackCandidate {
  return r1PdfFallbackCandidateSchema.parse(input);
}
