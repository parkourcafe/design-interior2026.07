import { CURRENT_CONTRACT_VERSION } from "./schema-registry";
import type { LayoutDocument } from "./types";

/**
 * Сборка новой планировки из габаритов помещения.
 *
 * Это компромисс, выбранный сознательно. Движок сегодня умеет только менять
 * существующее: команд «добавить стену» и «удалить» у него нет, поэтому пустой
 * документ был бы бесполезен — рисовать в нём нечем. Прямоугольная коробка,
 * собранная целиком, даёт рабочую отправную точку сразу: стены и высота уже
 * есть, дальше их можно двигать и править существующими командами.
 *
 * Свободное рисование стен мышью — отдельная задача и отдельное решение
 * владельца. Эта функция ему не мешает: она порождает обычный документ по
 * замороженной схеме, а не какой-то особый «сгенерированный» вид.
 *
 * Система координат совпадает с фикстурами: начало в юго-западном углу, Y
 * растёт на север. Стены обходятся по часовой стрелке от северо-западного угла.
 */

export interface RoomSpec {
  /** Ширина по оси X, мм. */
  readonly widthMm: number;
  /** Глубина по оси Y, мм. */
  readonly depthMm: number;
  /** Высота помещения в свету, мм. */
  readonly clearHeightMm: number;
  /** Название, которое увидит дизайнер. */
  readonly name: string;
  /**
   * uuid проекта-владельца из базы. Внутри документа он превращается в слаг
   * `project.<uuid>`: projectId в замороженной схеме — доменный идентификатор
   * (общий ASCII-набор stableId), а не сырой ключ строки, и слаг делает
   * происхождение значения явным.
   */
  readonly projectUuid: string;
  /** Канонический id документа: уникален глобально. */
  readonly documentId: string;
}

/** Границы вменяемости. Не архитектурная норма, а защита от опечатки. */
export const ROOM_LIMITS = {
  minSideMm: 500,
  maxSideMm: 100_000,
  minHeightMm: 1_500,
  maxHeightMm: 20_000,
} as const;

export type RoomSpecIssue =
  | "WIDTH_OUT_OF_RANGE"
  | "DEPTH_OUT_OF_RANGE"
  | "HEIGHT_OUT_OF_RANGE"
  | "NON_INTEGER_MILLIMETRES"
  | "NAME_REQUIRED"
  | "PROJECT_REQUIRED";

/**
 * Проверка ДО сборки документа. Отдельно от схемы: схема скажет «документ
 * невалиден», а дизайнеру нужно знать, какое именно поле он ввёл неверно.
 */
export function validateRoomSpec(spec: RoomSpec): RoomSpecIssue[] {
  const issues: RoomSpecIssue[] = [];
  const { minSideMm, maxSideMm, minHeightMm, maxHeightMm } = ROOM_LIMITS;

  if (!Number.isInteger(spec.widthMm) || !Number.isInteger(spec.depthMm) || !Number.isInteger(spec.clearHeightMm)) {
    // Миллиметр — канонический неделимый шаг: дробь означала бы, что где-то
    // потерялась единица измерения.
    issues.push("NON_INTEGER_MILLIMETRES");
  }
  if (spec.widthMm < minSideMm || spec.widthMm > maxSideMm) issues.push("WIDTH_OUT_OF_RANGE");
  if (spec.depthMm < minSideMm || spec.depthMm > maxSideMm) issues.push("DEPTH_OUT_OF_RANGE");
  if (spec.clearHeightMm < minHeightMm || spec.clearHeightMm > maxHeightMm) {
    issues.push("HEIGHT_OUT_OF_RANGE");
  }
  if (spec.name.trim().length === 0) issues.push("NAME_REQUIRED");
  if (!/^[0-9a-f-]{8,}$/i.test(spec.projectUuid)) issues.push("PROJECT_REQUIRED");

  return issues;
}

const WALL_THICKNESS_MM = 100;

export function createRoomDocument(spec: RoomSpec): LayoutDocument {
  const issues = validateRoomSpec(spec);
  if (issues.length > 0) {
    throw new Error(`Некорректные габариты помещения: ${issues.join(", ")}`);
  }

  const base = spec.documentId;
  const node = (corner: string) => `node.${base}.${corner}`;
  const { widthMm, depthMm, clearHeightMm } = spec;

  const corners = [
    { id: node("nw"), xMm: 0, yMm: depthMm },
    { id: node("ne"), xMm: widthMm, yMm: depthMm },
    { id: node("se"), xMm: widthMm, yMm: 0 },
    { id: node("sw"), xMm: 0, yMm: 0 },
  ];

  const sides = [
    { key: "north", from: "nw", to: "ne", label: "Северная стена" },
    { key: "east", from: "ne", to: "se", label: "Восточная стена" },
    { key: "south", from: "se", to: "sw", label: "Южная стена" },
    { key: "west", from: "sw", to: "nw", label: "Западная стена" },
  ];

  const walls = sides.map((side) => ({
    id: `wall.${base}.${side.key}`,
    startNodeId: node(side.from),
    endNodeId: node(side.to),
    thicknessMm: WALL_THICKNESS_MM,
    heightMm: clearHeightMm,
    kind: "existing" as const,
    // Стены контура не заблокированы: габариты — первое, что дизайнер
    // уточняет после обмера, и запирать их было бы вредно.
    locked: false,
    label: side.label,
  }));

  const material = {
    id: `material.${base}.wall`,
    labelRu: "Матовая штукатурка",
    baseColor: "#D8D3C8",
    roughness: 0.9,
    metalness: 0,
    emissive: "#000000",
    emissiveIntensity: 0,
    provenance: "RemHaOS: значение по умолчанию для новой планировки",
  };

  return {
    contractVersion: CURRENT_CONTRACT_VERSION,
    documentId: spec.documentId,
    projectId: `project.${spec.projectUuid.toLowerCase()}`,
    name: spec.name.trim(),
    canonicalUnits: "mm",
    stateRevision: 0,
    floor: {
      id: `floor.${base}.main`,
      label: "Этаж",
      elevationMm: 0,
      clearHeightMm,
    },
    variant: {
      id: `variant.${base}.a`,
      label: "Вариант A",
      // draft, а не review: габариты введены с чьих-то слов и ещё не обмеряны.
      status: "draft",
    },
    nodes: corners.map((corner) => ({ ...corner, locked: false })),
    walls,
    openings: [],
    columns: [],
    objects: [],
    clearanceZones: [],
    materials: [material],
    materialAssignments: walls.map((wall) => ({
      id: `assignment.${base}.${wall.id.split(".").pop()}`,
      targetId: wall.id,
      surfaceRole: "all",
      materialId: material.id,
    })),
    lights: [
      {
        id: `light.${base}.ambient`,
        kind: "ambient",
        xMm: Math.round(widthMm / 2),
        yMm: Math.round(depthMm / 2),
        zMm: Math.max(0, clearHeightMm - 300),
        color: "#FFFFFF",
        intensity: 1,
        label: "Общий свет",
      },
    ],
    metadata: {
      sourceRefs: [`user-input://room-dimensions/${spec.documentId}`],
      // Честная пометка: габариты введены руками, обмера не было. Она уедет во
      // все выгрузки, как и остальные предупреждения.
      warnings: ["DIMENSIONS_FROM_USER_INPUT_NOT_SURVEYED"],
    },
  } as unknown as LayoutDocument;
}
