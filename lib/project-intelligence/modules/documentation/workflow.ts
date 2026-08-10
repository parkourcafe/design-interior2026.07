import { DecisionContractError } from "../decisions";
import type {
  AttachSheetSpecificationsInput,
  DocumentationCompletenessFinding,
  DocumentationCompletenessReport,
  DocumentationSheet,
  DocumentationSheetHandoffInput,
  RegisterDocumentationSheetInput,
  ReviewPackageCompletenessInput,
} from "./contracts";

const SEMANTIC_HASH = /^sha256:[0-9a-f]{64}$/;

function immutable<T>(value: T): T {
  const cloned = structuredClone(value);

  const freeze = (candidate: unknown): void => {
    if (
      candidate === null
      || typeof candidate !== "object"
      || Object.isFrozen(candidate)
    ) {
      return;
    }

    for (const child of Object.values(candidate as Record<string, unknown>)) {
      freeze(child);
    }
    Object.freeze(candidate);
  };

  freeze(cloned);
  return cloned;
}

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

function requireRevisionReason(reason: string): void {
  if (isBlank(reason)) {
    throw new DecisionContractError(
      "DOCUMENTATION_SHEET_REVISION_REASON_REQUIRED",
      "A documentation sheet revision requires a reason.",
    );
  }
}

/**
 * Вход обязан быть тем самым exact handoff, а не похожим на него объектом:
 * подпись планировки проверяется по формату, а комната листа — на членство
 * в переданном handoff (A5 §2 — единственная дверь, обходов нет).
 */
function requireExactHandoff(handoff: DocumentationSheetHandoffInput): void {
  if (
    isBlank(handoff.contractVersion)
    || isBlank(handoff.projectId)
    || isBlank(handoff.packageId)
    || isBlank(handoff.roomId)
    || isBlank(handoff.approvedM2CommitRevisionId)
    || isBlank(handoff.designIntentRevisionId)
    || isBlank(handoff.layout.documentId)
    || isBlank(handoff.layout.versionId)
    || isBlank(handoff.layout.revisionId)
  ) {
    throw new DecisionContractError(
      "DOCUMENTATION_SHEET_HANDOFF_INCOMPLETE",
      "The M2 handoff is missing required exact references.",
    );
  }

  if (!SEMANTIC_HASH.test(handoff.layout.semanticHash)) {
    throw new DecisionContractError(
      "DOCUMENTATION_SHEET_LAYOUT_SIGNATURE_INVALID",
      "The layout signature must be sha256:<hex>.",
    );
  }
}

function requireApprovedSpecifications(
  requested: readonly string[],
  approved: readonly string[],
): void {
  if (new Set(requested).size !== requested.length) {
    throw new DecisionContractError(
      "DOCUMENTATION_SHEET_DUPLICATE_SPECIFICATION",
      "A specification revision cannot be listed twice on one sheet.",
    );
  }

  for (const revisionId of requested) {
    if (isBlank(revisionId)) {
      throw new DecisionContractError(
        "DOCUMENTATION_SHEET_SPECIFICATION_INVALID",
        "Specification revision IDs must be non-blank.",
      );
    }
    // Лист не вправе ссылаться на выбор вне утверждённого набора: это был бы
    // разрыв доказуемости между тем, что клиент утвердил, и тем, что выдано.
    if (!approved.includes(revisionId)) {
      throw new DecisionContractError(
        "DOCUMENTATION_SHEET_SPECIFICATION_NOT_APPROVED",
        "A sheet may only reference selection revisions approved in M2.",
      );
    }
  }
}

export function registerDocumentationSheet(
  input: RegisterDocumentationSheetInput,
): DocumentationSheet {
  if (isBlank(input.sheetId) || isBlank(input.sheetNumber) || isBlank(input.title)) {
    throw new DecisionContractError(
      "DOCUMENTATION_SHEET_INVALID_ID",
      "Sheet ID, sheet number and title must be non-blank.",
    );
  }

  requireRevisionReason(input.revision.reason);
  requireExactHandoff(input.handoff);

  if (input.roomId !== input.handoff.roomId) {
    throw new DecisionContractError(
      "DOCUMENTATION_SHEET_ROOM_MISMATCH",
      "The sheet room must match the room of the approved handoff.",
    );
  }

  requireApprovedSpecifications(
    input.specificationRevisionIds,
    input.handoff.selectionRevisionIds,
  );

  return immutable({
    sheetId: input.sheetId,
    projectId: input.handoff.projectId,
    packageId: input.handoff.packageId,
    roomId: input.handoff.roomId,
    sheetNumber: input.sheetNumber,
    title: input.title,
    revision: input.revision,
    origin: {
      handoffContractVersion: input.handoff.contractVersion,
      approvedM2CommitRevisionId: input.handoff.approvedM2CommitRevisionId,
      designIntentRevisionId: input.handoff.designIntentRevisionId,
      layoutDocumentId: input.handoff.layout.documentId,
      layoutVersionId: input.handoff.layout.versionId,
      layoutRevisionId: input.handoff.layout.revisionId,
      semanticHash: input.handoff.layout.semanticHash,
    },
    specificationRevisionIds: [...input.specificationRevisionIds],
  });
}

/**
 * Привязывает спецификации новой ревизией листа.
 *
 * Прежняя ревизия не мутируется: выпущенное состояние остаётся ровно таким,
 * каким было выпущено (append-only, `AGENTS.md`). Происхождение переносится
 * без изменений — оно свойство листа, а не ревизии.
 */
export function attachSheetSpecifications(
  sheet: DocumentationSheet,
  input: AttachSheetSpecificationsInput,
): DocumentationSheet {
  requireRevisionReason(input.revision.reason);

  if (input.revision.revisionNo <= sheet.revision.revisionNo) {
    throw new DecisionContractError(
      "DOCUMENTATION_SHEET_REVISION_NOT_NEWER",
      "A sheet revision must be newer than the current one.",
    );
  }

  // Тот же инвариант, что при регистрации: лист не вправе ссылаться на выбор
  // вне утверждённого набора — и привязка не даёт обходного пути.
  requireApprovedSpecifications(
    input.specificationRevisionIds,
    input.approvedSelectionRevisionIds,
  );

  for (const revisionId of input.specificationRevisionIds) {
    if (sheet.specificationRevisionIds.includes(revisionId)) {
      throw new DecisionContractError(
        "DOCUMENTATION_SHEET_SPECIFICATION_ALREADY_ATTACHED",
        "This specification revision is already attached to the sheet.",
      );
    }
  }

  return immutable({
    ...sheet,
    revision: input.revision,
    specificationRevisionIds: [
      ...sheet.specificationRevisionIds,
      ...input.specificationRevisionIds,
    ],
  });
}

/**
 * Считает комплектность пакета по утверждённому решению M2.
 *
 * Функция ничего не утверждает и не выпускает — она только называет, чего
 * не хватает; решение принимает человек (`AGENTS.md`: AI не утверждает и не
 * выпускает автоматически). Состав обязательных листов нигде не зафиксирован,
 * поэтому проверяется лишь то, что объективно следует из handoff: покрыта ли
 * комната, отражён ли каждый утверждённый выбор, из одного ли утверждения
 * собран пакет и однозначны ли номера листов.
 *
 * Порядок находок детерминирован: отчёт сравнивают с прошлым прогоном.
 */
export function reviewPackageCompleteness(
  input: ReviewPackageCompletenessInput,
): DocumentationCompletenessReport {
  const findings: DocumentationCompletenessFinding[] = [];
  const ownSheets = input.sheets.filter(
    (sheet) => sheet.origin.approvedM2CommitRevisionId
      === input.handoff.approvedM2CommitRevisionId,
  );

  if (!ownSheets.some((sheet) => sheet.roomId === input.handoff.roomId)) {
    findings.push({ code: "ROOM_WITHOUT_SHEET", subject: input.handoff.roomId });
  }

  const covered = new Set(
    ownSheets.flatMap((sheet) => [...sheet.specificationRevisionIds]),
  );
  for (const revisionId of input.handoff.selectionRevisionIds) {
    if (!covered.has(revisionId)) {
      findings.push({ code: "SPECIFICATION_NOT_COVERED", subject: revisionId });
    }
  }

  for (const sheet of input.sheets) {
    if (
      sheet.origin.approvedM2CommitRevisionId
      !== input.handoff.approvedM2CommitRevisionId
    ) {
      findings.push({ code: "SHEET_FROM_OTHER_APPROVAL", subject: sheet.sheetId });
    }
  }

  const seenNumbers = new Set<string>();
  const reportedNumbers = new Set<string>();
  for (const sheet of input.sheets) {
    if (seenNumbers.has(sheet.sheetNumber) && !reportedNumbers.has(sheet.sheetNumber)) {
      findings.push({ code: "DUPLICATE_SHEET_NUMBER", subject: sheet.sheetNumber });
      reportedNumbers.add(sheet.sheetNumber);
    }
    seenNumbers.add(sheet.sheetNumber);
  }

  return immutable({ complete: findings.length === 0, findings });
}
