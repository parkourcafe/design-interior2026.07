import type { DomainIssue, DomainResult } from "./errors";
import type { BoundingBox, SourceLocator } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
}

function issue(code: DomainIssue["code"], path: string, message: string): DomainResult<never> {
  return { ok: false, issues: [{ code, path, message }] };
}

function isBoundingBox(value: unknown): value is BoundingBox {
  return Array.isArray(value)
    && value.length === 4
    && value.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate));
}

function validBoxOrder(box: BoundingBox): boolean {
  return box[0] < box[2] && box[1] < box[3];
}

function isNormalizedBox(box: BoundingBox): boolean {
  return validBoxOrder(box) && box.every((coordinate) => coordinate >= 0 && coordinate <= 1);
}

function isPixelBox(box: BoundingBox): boolean {
  return validBoxOrder(box) && box.every((coordinate) => coordinate >= 0);
}

export function validateSourceLocator(value: unknown): DomainResult<SourceLocator> {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return issue("unknown_locator_kind", "/kind", "Locator kind is required and must be supported.");
  }

  switch (value.kind) {
    case "pdf": {
      if (!isFiniteInteger(value.page) || value.page < 1) {
        return issue("invalid_locator_page", "/page", "PDF page must be a 1-based positive integer.");
      }
      if (value.bbox !== undefined && (!isBoundingBox(value.bbox) || !isNormalizedBox(value.bbox))) {
        return issue("invalid_locator_bbox", "/bbox", "PDF bbox must be ordered normalized coordinates.");
      }
      return { ok: true, value: value as unknown as SourceLocator };
    }
    case "transcript": {
      if (!isFiniteInteger(value.startMs) || value.startMs < 0) {
        return issue("invalid_locator_interval", "/startMs", "Transcript start must be a non-negative integer.");
      }
      if (!isFiniteInteger(value.endMs) || value.endMs <= value.startMs) {
        return issue("invalid_locator_interval", "/endMs", "Transcript end must be after its start.");
      }
      if (value.speaker !== undefined && (typeof value.speaker !== "string" || !value.speaker.trim())) {
        return issue("empty_locator_identifier", "/speaker", "Transcript speaker cannot be empty when provided.");
      }
      return { ok: true, value: value as unknown as SourceLocator };
    }
    case "image": {
      if (value.coordinateSystem !== "pixel" && value.coordinateSystem !== "normalized") {
        return issue("invalid_locator_bbox", "/coordinateSystem", "Image coordinate system must be explicit.");
      }
      if (!isBoundingBox(value.bbox)) {
        return issue("invalid_locator_bbox", "/bbox", "Image bbox must contain four finite coordinates.");
      }
      const valid = value.coordinateSystem === "pixel" ? isPixelBox(value.bbox) : isNormalizedBox(value.bbox);
      if (!valid) return issue("invalid_locator_bbox", "/bbox", "Image bbox is outside its coordinate system.");
      return { ok: true, value: value as unknown as SourceLocator };
    }
    case "spreadsheet": {
      if (typeof value.sheet !== "string" || !value.sheet.trim()) {
        return issue("empty_locator_identifier", "/sheet", "Spreadsheet sheet cannot be empty.");
      }
      if (typeof value.cellRange !== "string" || !value.cellRange.trim()) {
        return issue("empty_locator_identifier", "/cellRange", "Spreadsheet cell range cannot be empty.");
      }
      return { ok: true, value: value as unknown as SourceLocator };
    }
    case "email": {
      if (typeof value.messageId !== "string" || !value.messageId.trim()) {
        return issue("empty_locator_identifier", "/messageId", "Email message ID cannot be empty.");
      }
      if (value.paragraph !== undefined && (!isFiniteInteger(value.paragraph) || value.paragraph < 1)) {
        return issue("invalid_locator_interval", "/paragraph", "Email paragraph must be a positive integer.");
      }
      if (value.part !== undefined && (typeof value.part !== "string" || !value.part.trim())) {
        return issue("empty_locator_identifier", "/part", "Email part cannot be empty when provided.");
      }
      if (value.paragraph === undefined && value.part === undefined) {
        return issue("empty_locator_identifier", "/paragraph", "Email locator requires a paragraph or part.");
      }
      return { ok: true, value: value as unknown as SourceLocator };
    }
    case "plain_text": {
      if (!isFiniteInteger(value.startCharacter) || value.startCharacter < 0) {
        return issue("invalid_locator_interval", "/startCharacter", "Text start must be a non-negative code-point offset.");
      }
      if (!isFiniteInteger(value.endCharacter) || value.endCharacter <= value.startCharacter) {
        return issue("invalid_locator_interval", "/endCharacter", "Text end must be after its start.");
      }
      return { ok: true, value: value as unknown as SourceLocator };
    }
    default:
      return issue("unknown_locator_kind", "/kind", `Unsupported locator kind: ${value.kind}.`);
  }
}
