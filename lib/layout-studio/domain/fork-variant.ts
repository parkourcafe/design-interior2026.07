import type { LayoutDocument } from "./types";

/**
 * Копия планировки под новый вариант комнаты.
 *
 * Экономичный и премиальный варианты — это отдельные документы, привязанные к
 * той же комнате с другой ролью: так их версии публикуются независимыми
 * цепочками, а клиент на витрине сравнивает три самостоятельных чертежа.
 * До этой функции путь был ручным — «создать планировку заново и перерисовать»;
 * теперь вариант начинается с точной копии геометрии.
 *
 * Меняются ровно четыре вещи: id документа, id и подпись варианта, счётчик
 * ревизий (копия начинает свою историю с нуля). Вся геометрия, материалы и
 * предупреждения переносятся байт в байт — включая честные пометки вроде
 * «размеры со слов, обмера не было»: копия не делает данные достовернее.
 *
 * В sourceRefs дописывается провенанс `forked-from://layout/<исходный id>` —
 * след происхождения уезжает и во все выгрузки новой ветки.
 */

export interface ForkSpec {
  /** id нового документа. Уникальность обеспечивает вызывающий (uuid). */
  readonly documentId: string;
  /** Подпись варианта человеческими словами («Экономичный вариант»). */
  readonly variantLabel: string;
}

export function forkLayoutDocument(source: LayoutDocument, spec: ForkSpec): LayoutDocument {
  const fork = structuredClone(source);

  (fork as { documentId: string }).documentId = spec.documentId;
  fork.variant = {
    ...fork.variant,
    // Той же формы, что даёт createRoomDocument: variant.<база>.a — база
    // нового документа гарантирует глобальную уникальность id варианта.
    id: `variant.${spec.documentId}.a`,
    label: spec.variantLabel,
    // Копия — черновик своей собственной истории, чем бы ни был источник.
    status: "draft",
  };
  (fork as { stateRevision: number }).stateRevision = 0;

  fork.metadata = {
    ...fork.metadata,
    sourceRefs: [...fork.metadata.sourceRefs, `forked-from://layout/${source.documentId}`],
    warnings: [...fork.metadata.warnings],
  };

  return fork;
}
