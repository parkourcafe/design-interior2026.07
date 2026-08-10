import type { RevisionIdentity } from "../decisions";

/**
 * Происхождение листа: из какого утверждённого решения M2 он построен.
 *
 * Это несущее свойство модуля, а не метаданные. Лист, у которого нельзя
 * назвать версию планировки и её подпись, ничего не доказывает — а пакет
 * документации продаётся именно как доказательство принятых решений.
 * Поля копируются из exact handoff и не задаются вызывающей стороной.
 */
export interface DocumentationSheetOrigin {
  readonly handoffContractVersion: string;
  readonly approvedM2CommitRevisionId: string;
  readonly designIntentRevisionId: string;
  readonly layoutDocumentId: string;
  readonly layoutVersionId: string;
  readonly layoutRevisionId: string;
  /** Подпись версии планировки в формате `sha256:<hex>`. */
  readonly semanticHash: string;
}

/** Лист пакета документации: одна страница, привязанная к комнате. */
export interface DocumentationSheet {
  readonly sheetId: string;
  readonly projectId: string;
  readonly packageId: string;
  readonly roomId: string;
  /** Номер листа в пакете, например `A-101`. */
  readonly sheetNumber: string;
  readonly title: string;
  readonly revision: RevisionIdentity;
  readonly origin: DocumentationSheetOrigin;
  /** Ревизии утверждённых выборов M2, которые лист фиксирует. */
  readonly specificationRevisionIds: readonly string[];
}

/**
 * Вход из M2 — структурная форма `M2ToM3Handoff`.
 *
 * Модуль принимает её как данные, а не импортирует тип из слоя application:
 * доменные модули не зависят от него. Совпадение формы удерживается тестом
 * `documentation-handoff-shape`.
 */
export interface DocumentationSheetHandoffInput {
  readonly contractVersion: string;
  readonly projectId: string;
  readonly packageId: string;
  readonly roomId: string;
  readonly approvedM2CommitRevisionId: string;
  readonly designIntentRevisionId: string;
  readonly layout: {
    readonly documentId: string;
    readonly versionId: string;
    readonly revisionId: string;
    readonly semanticHash: string;
  };
  readonly selectionRevisionIds: readonly string[];
}

export interface RegisterDocumentationSheetInput {
  readonly sheetId: string;
  readonly sheetNumber: string;
  readonly title: string;
  readonly roomId: string;
  readonly revision: RevisionIdentity;
  readonly handoff: DocumentationSheetHandoffInput;
  readonly specificationRevisionIds: readonly string[];
}

export interface AttachSheetSpecificationsInput {
  readonly specificationRevisionIds: readonly string[];
  /**
   * Утверждённый набор из того же handoff, от которого лист заведён. Лист
   * его не хранит (это свойство утверждения, не листа), поэтому вызывающая
   * сторона обязана его передать — сервер при привязке точно так же
   * перечитывает handoff.
   */
  readonly approvedSelectionRevisionIds: readonly string[];
  readonly revision: RevisionIdentity;
}

/**
 * Виды неполноты пакета.
 *
 * Каждый выводится из данных, а не из представлений о «правильном комплекте»:
 * состав обязательных листов нигде не утверждён, поэтому модуль проверяет
 * только то, что объективно следует из утверждённого решения M2.
 */
export type DocumentationCompletenessCode =
  /** Комната утверждённого решения не покрыта ни одним листом. */
  | "ROOM_WITHOUT_SHEET"
  /** Утверждённый клиентом выбор не отражён ни на одном листе пакета. */
  | "SPECIFICATION_NOT_COVERED"
  /** Лист построен из другого утверждения — пакет выражал бы два решения сразу. */
  | "SHEET_FROM_OTHER_APPROVAL"
  /** Два листа с одним номером: ссылка на номер перестаёт быть однозначной. */
  | "DUPLICATE_SHEET_NUMBER";

export interface DocumentationCompletenessFinding {
  readonly code: DocumentationCompletenessCode;
  /** Комната, ревизия выбора, идентификатор листа или номер листа. */
  readonly subject: string;
}

export interface DocumentationCompletenessReport {
  readonly complete: boolean;
  readonly findings: readonly DocumentationCompletenessFinding[];
}

export interface ReviewPackageCompletenessInput {
  readonly handoff: DocumentationSheetHandoffInput;
  readonly sheets: readonly DocumentationSheet[];
}
