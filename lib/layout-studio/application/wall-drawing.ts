import type { LayoutDocument } from "@/lib/layout-studio/domain";

/**
 * Геометрия рисования стен: привязки, ортогональ, замыкание контура.
 *
 * Вынесено из компонента намеренно. Это чистые функции над числами, и их
 * можно проверить тестами без браузера — а привязка как раз то место, где
 * ошибка в 5 мм превращается в незамкнутый контур и неверную площадь.
 *
 * Координаты — миллиметры документа. План рисует их один в один, без
 * переворота оси, поэтому пересчёт из экранных координат делает сам SVG
 * (getScreenCTM), а здесь работа идёт уже в миллиметрах.
 */

export interface Point {
  readonly xMm: number;
  readonly yMm: number;
}

export interface SnapResult extends Point {
  /** Идентификатор существующего узла, если привязались к нему. */
  readonly nodeId?: string;
  readonly kind: "node" | "orthogonal" | "grid";
}

/** Шаг сетки. 50 мм — компромисс: мельче не нужно на плане, крупнее грубо. */
export const GRID_MM = 50;

/**
 * Радиус захвата узла В МИЛЛИМЕТРАХ ДОКУМЕНТА, а не в пикселях: он делится на
 * масштаб, чтобы на любом зуме «схватить» было одинаково легко пальцем.
 */
export const NODE_SNAP_RADIUS_PX = 14;

/** Ортогональ включается, пока отклонение от оси меньше этого угла. */
const ORTHOGONAL_TOLERANCE_MM = 250;

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm);
}

/**
 * Куда на самом деле встанет точка при клике.
 *
 * Порядок приоритетов не случаен:
 * 1. существующий узел — попасть в угол важнее всего, иначе контур не
 *    замкнётся и площадь посчитается неверно;
 * 2. ортогональ относительно предыдущей точки — стены почти всегда прямые,
 *    и промах на пару миллиметров не должен делать их косыми;
 * 3. сетка — общий случай.
 *
 * @param snapRadiusMm радиус захвата узла в миллиметрах документа. Вызывающий
 *   получает его делением экранного радиуса на масштаб, поэтому на разном
 *   зуме захват ощущается одинаково.
 */
export function snapPoint(
  document: LayoutDocument,
  raw: Point,
  options: { readonly anchor?: Point | null; readonly snapRadiusMm: number },
): SnapResult {
  let nearest: { node: (typeof document.nodes)[number]; distanceMm: number } | null = null;
  for (const node of document.nodes) {
    const distanceMm = distance(raw, node);
    if (distanceMm <= options.snapRadiusMm && (!nearest || distanceMm < nearest.distanceMm)) {
      nearest = { node, distanceMm };
    }
  }
  if (nearest) {
    return { xMm: nearest.node.xMm, yMm: nearest.node.yMm, nodeId: nearest.node.id, kind: "node" };
  }

  const anchor = options.anchor;
  if (anchor) {
    const dx = Math.abs(raw.xMm - anchor.xMm);
    const dy = Math.abs(raw.yMm - anchor.yMm);
    // Ближе к вертикали — держим X якоря, и наоборот. Порог не даёт
    // «прилипнуть» к оси там, где стена задумана под углом.
    if (dx <= ORTHOGONAL_TOLERANCE_MM && dx < dy) {
      return { xMm: anchor.xMm, yMm: roundTo(raw.yMm, GRID_MM), kind: "orthogonal" };
    }
    if (dy <= ORTHOGONAL_TOLERANCE_MM && dy < dx) {
      return { xMm: roundTo(raw.xMm, GRID_MM), yMm: anchor.yMm, kind: "orthogonal" };
    }
  }

  return { xMm: roundTo(raw.xMm, GRID_MM), yMm: roundTo(raw.yMm, GRID_MM), kind: "grid" };
}

/** Длина будущей стены — показывается прямо при ведении. */
export function segmentLengthMm(from: Point, to: Point): number {
  return Math.round(distance(from, to));
}

/**
 * Стена нулевой длины бессмысленна и всё равно будет отклонена валидацией.
 * Проверяем заранее, чтобы двойной клик по одной точке не выглядел как сбой.
 */
export function isDegenerate(from: Point, to: Point): boolean {
  return segmentLengthMm(from, to) < GRID_MM;
}

/** Уже существует стена между этими узлами? Второй раз рисовать её незачем. */
export function wallExistsBetween(
  document: LayoutDocument,
  startNodeId: string,
  endNodeId: string,
): boolean {
  return document.walls.some(
    (wall) =>
      (wall.startNodeId === startNodeId && wall.endNodeId === endNodeId) ||
      (wall.startNodeId === endNodeId && wall.endNodeId === startNodeId),
  );
}

/**
 * Идентификаторы для новых сущностей.
 *
 * Замороженная схема требует шаблон ^[a-z][a-z0-9._-]{2,127}$, поэтому
 * произвольная строка не годится. Порядковый номер берётся от количества уже
 * существующих: он читаем в отладке, а уникальность всё равно проверяет
 * команда.
 */
export function nextEntityId(document: LayoutDocument, kind: "node" | "wall"): string {
  const pool = kind === "node" ? document.nodes : document.walls;
  const base = document.documentId;
  let index = pool.length + 1;
  let candidate = `${kind}.${base}.draw-${index}`;
  const taken = new Set(pool.map((item) => item.id));
  while (taken.has(candidate)) {
    index += 1;
    candidate = `${kind}.${base}.draw-${index}`;
  }
  return candidate;
}
