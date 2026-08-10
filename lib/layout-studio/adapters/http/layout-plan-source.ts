import {
  createSvgProjection,
  serializeSvgProjection,
} from "@/lib/layout-studio/adapters/svg/svg-projection";
import {
  deriveLayout,
  validateLayoutDocument,
  type LayoutDocument,
} from "@/lib/layout-studio/domain";

/**
 * План опубликованной версии для витрины согласования (§8.4).
 *
 * Клиент выбирает вариант не по номеру ревизии, а по чертежу — эта функция
 * превращает строку проекции m2LayoutVersions в готовый SVG. Чистая функция
 * без сети: сеть остаётся в компоненте, логика — здесь, под тестами.
 *
 * Возвращает null, а не бросает: миниатюра — усиление витрины, не её
 * несущая стена. Нет строки, не проходит схему, не выводится геометрия —
 * витрина продолжает работать словами.
 */
export function pickLayoutPlanSvg(
  rows: unknown,
  layoutRevisionId: string,
): string | null {
  if (!Array.isArray(rows)) return null;
  const row = rows.find(
    (candidate): candidate is { revisionId: string; payload: { layoutContent: unknown } } =>
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as { revisionId?: unknown }).revisionId === layoutRevisionId &&
      typeof (candidate as { payload?: unknown }).payload === "object" &&
      (candidate as { payload: unknown }).payload !== null,
  );
  if (!row) return null;

  const content = (row.payload as { layoutContent?: unknown }).layoutContent;
  // Схему проверяет validate; после положительного ответа приведение честное.
  if (!validateLayoutDocument(content as LayoutDocument).valid) return null;

  try {
    const derived = deriveLayout(content as LayoutDocument);
    return serializeSvgProjection(createSvgProjection(derived));
  } catch {
    return null;
  }
}

/** SVG → data-URI для <img>: без вставки сырой разметки в DOM витрины. */
export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
