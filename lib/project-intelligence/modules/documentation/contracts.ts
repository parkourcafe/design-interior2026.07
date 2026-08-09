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
  readonly revision: RevisionIdentity;
}
