import { describe, expect, it } from "vitest";

import {
  parseR1PdfFallbackCandidate,
  r1PdfDeclaredGeometrySchema,
  R1_PDF_FALLBACK_CONTRACT_VERSION,
  R1_PDF_FALLBACK_WARNING,
} from "./r1-pdf-fallback-contract";

const identifiers = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
] as const;

const validCandidate = () => ({
  contractVersion: R1_PDF_FALLBACK_CONTRACT_VERSION,
  sourceDwgAssetVersionId: identifiers[0],
  pdfAssetVersionId: identifiers[1],
  representationVersionId: identifiers[2],
  pairAttestationId: identifiers[3],
  documentationSheetId: "M3-SHEET-01",
  documentationSheetRevisionId: "M3-SHEET-01-R1",
  producer: "architect_provided",
  conversionStatus: "unconfirmed",
  pdfPageIndex: 0,
  pdfCrop: { left: 0, top: 0, right: 1, bottom: 1 },
  rotationDegrees: 0,
  units: "mm",
  axes: "z-up",
  pageToPreviewTransform: [1, 0, 0, 1, 0, 0],
});

describe("R1 architect-provided PDF fallback contract", () => {
  it("accepts exact opaque identifiers and finite page geometry", () => {
    expect(parseR1PdfFallbackCandidate(validCandidate())).toMatchObject({
      conversionStatus: "unconfirmed",
      producer: "architect_provided",
      pdfPageIndex: 0,
    });
    expect(R1_PDF_FALLBACK_WARNING).toBe("PDF предоставлен архитектором; DWG conversion не подтверждён");
  });

  it.each([
    ["claimed conversion", { conversionStatus: "confirmed" }],
    ["untrusted producer", { producer: "converter" }],
    ["negative page", { pdfPageIndex: -1 }],
    ["degenerate crop", { pdfCrop: { left: 0.5, top: 0, right: 0.5, bottom: 1 } }],
    ["out-of-range crop", { pdfCrop: { left: -0.1, top: 0, right: 1, bottom: 1 } }],
    ["invalid rotation", { rotationDegrees: 45 }],
    ["non-invertible transform", { pageToPreviewTransform: [1, 2, 2, 4, 0, 0] }],
    ["overflowing determinant", { pageToPreviewTransform: [1e308, 1e308, 1e308, 1e308, 0, 0] }],
    ["overflowing transformed corner", { pageToPreviewTransform: [1e308, 0, 1e308, 1, 0, 0] }],
    ["overflowing inverse translation", { pageToPreviewTransform: [1e-308, 0, 0, 1, 1e308, 0] }],
    ["non-finite transform", { pageToPreviewTransform: [Infinity, 0, 0, 1, 0, 0] }],
    ["unsafe page index", { pdfPageIndex: Number.MAX_SAFE_INTEGER + 1 }],
  ])("rejects %s", (_name, patch) => {
    expect(() => parseR1PdfFallbackCandidate({ ...validCandidate(), ...patch })).toThrow();
  });

  it("rejects caller-supplied authority and byte claims", () => {
    expect(() => parseR1PdfFallbackCandidate({
      ...validCandidate(),
      architectUserId: identifiers[0],
      sourceSha256: "a".repeat(64),
      conversionPassed: true,
    })).toThrow();
  });

  it("uses the existing bounded sheet and revision identity, not a UUID-only surrogate", () => {
    expect(parseR1PdfFallbackCandidate(validCandidate())).toMatchObject({
      documentationSheetId: "M3-SHEET-01",
      documentationSheetRevisionId: "M3-SHEET-01-R1",
    });
  });
});

describe("reusable architect-declared page geometry", () => {
  it("reuses the same bounds without requiring fake representation identifiers", () => {
    const geometry = {pdfPageIndex:0,pdfCrop:{left:0,top:0,right:1,bottom:1},rotationDegrees:90,units:"mm",pageToPreviewTransform:[1,0,0,1,0,0]};
    expect(r1PdfDeclaredGeometrySchema.parse(geometry)).toEqual(geometry);
    expect(r1PdfDeclaredGeometrySchema.safeParse({...geometry,pageToPreviewTransform:[1e-308,0,0,1,1e308,0]}).success).toBe(false);
    expect(r1PdfDeclaredGeometrySchema.safeParse({...geometry,representationVersionId:identifiers[0]}).success).toBe(false);
  });
});
