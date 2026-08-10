import type { DerivedLayout, LayoutDocument } from "@/lib/layout-studio/domain";

/**
 * Экспорт плана в DXF — столп «без лицензий» (Addendum A4 §3, критерий §8.3
 * позиционирования): файл обязан открываться у подрядчика, чем бы тот ни
 * пользовался.
 *
 * Формат — DXF R12 (AC1009) ASCII. Выбран сознательно: это самый читаемый
 * диалект — его понимают AutoCAD, nanoCAD, LibreCAD, QCAD и все просмотрщики.
 * Никаких LWPOLYLINE и прочих пост-R12 сущностей: только LINE и TEXT — то,
 * что не сломается нигде.
 *
 * Правила честности:
 * - координаты — миллиметры документа, без масштабирования и без «подгонки»;
 * - провенанс (версия, подпись) — в 999-комментариях в начале файла;
 * - подписи транслитерируются в ASCII: кириллический TEXT в R12 зависит от
 *   кодовой страницы читающего CAD и превращается в кракозябры — честная
 *   латиница читается везде. Об этом сказано в комментарии файла.
 */

interface Point {
  xMm: number;
  yMm: number;
}

export interface DxfExportContext {
  versionId: string;
  /** Подпись версии, форма `sha256:<hex>` или голый hex — пишется как есть. */
  semanticHash: string;
}

const LAYERS = ["WALLS", "OPENINGS", "COLUMNS", "OBJECTS", "LABELS"] as const;
type DxfLayer = (typeof LAYERS)[number];

const TRANSLIT: Readonly<Record<string, string>> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh",
  щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** Подпись в ASCII: транслит с сохранением капитализации, прочее — пробел. */
export function asciiLabel(value: string): string {
  const mapped = [...value].map((character) => {
    if (/[\x20-\x7e]/.test(character)) return character;
    const lower = character.toLowerCase();
    const translit = TRANSLIT[lower];
    if (translit === undefined) return " ";
    if (character !== lower && translit.length > 0) {
      return translit[0]!.toUpperCase() + translit.slice(1);
    }
    return translit;
  });
  return mapped.join("").replace(/\s{2,}/g, " ").trim();
}

/** Числа в DXF: без экспоненты, до двух знаков, без хвостовых нулей. */
function num(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

class DxfWriter {
  private readonly lines: string[] = [];

  comment(text: string): void {
    this.pair(999, text);
  }

  pair(code: number, value: string): void {
    this.lines.push(String(code), value);
  }

  line(layer: DxfLayer, from: Point, to: Point): void {
    this.pair(0, "LINE");
    this.pair(8, layer);
    this.pair(10, num(from.xMm));
    this.pair(20, num(from.yMm));
    this.pair(30, "0");
    this.pair(11, num(to.xMm));
    this.pair(21, num(to.yMm));
    this.pair(31, "0");
  }

  polygon(layer: DxfLayer, points: readonly Point[]): void {
    for (let index = 0; index < points.length; index += 1) {
      const from = points[index]!;
      const to = points[(index + 1) % points.length]!;
      this.line(layer, from, to);
    }
  }

  text(layer: DxfLayer, position: Point, heightMm: number, value: string): void {
    const label = asciiLabel(value);
    if (label.length === 0) return;
    this.pair(0, "TEXT");
    this.pair(8, layer);
    this.pair(10, num(position.xMm));
    this.pair(20, num(position.yMm));
    this.pair(30, "0");
    this.pair(40, num(heightMm));
    this.pair(1, label);
  }

  serialize(): string {
    // CRLF — самый совместимый перевод строки для DXF-читалок.
    return this.lines.join("\r\n") + "\r\n";
  }
}

/** Прямоугольник вокруг центра с поворотом, допустимым в документе. */
function rotatedRect(
  center: Point,
  widthMm: number,
  depthMm: number,
  rotationDeg: 0 | 90 | 180 | 270,
): Point[] {
  const swap = rotationDeg === 90 || rotationDeg === 270;
  const halfW = (swap ? depthMm : widthMm) / 2;
  const halfD = (swap ? widthMm : depthMm) / 2;
  return [
    { xMm: center.xMm - halfW, yMm: center.yMm - halfD },
    { xMm: center.xMm + halfW, yMm: center.yMm - halfD },
    { xMm: center.xMm + halfW, yMm: center.yMm + halfD },
    { xMm: center.xMm - halfW, yMm: center.yMm + halfD },
  ];
}

export function exportLayoutToDxf(
  document: LayoutDocument,
  derived: DerivedLayout,
  context: DxfExportContext,
): string {
  const writer = new DxfWriter();

  // Провенанс — в комментариях: их не трогает ни один CAD, но видит человек.
  writer.comment("RemHaOS layout export, DXF R12 ASCII");
  writer.comment(`document: ${document.documentId}`);
  writer.comment(`version: ${context.versionId}`);
  writer.comment(`signature: ${context.semanticHash}`);
  writer.comment("units: millimetres");
  writer.comment("labels transliterated to ASCII for codepage-safe reading");

  // HEADER
  writer.pair(0, "SECTION");
  writer.pair(2, "HEADER");
  writer.pair(9, "$ACADVER");
  writer.pair(1, "AC1009");
  const bounds = derived.bounds;
  writer.pair(9, "$EXTMIN");
  writer.pair(10, num(bounds?.minXMm ?? 0));
  writer.pair(20, num(bounds?.minYMm ?? 0));
  writer.pair(30, "0");
  writer.pair(9, "$EXTMAX");
  writer.pair(10, num(bounds?.maxXMm ?? 0));
  writer.pair(20, num(bounds?.maxYMm ?? 0));
  writer.pair(30, "0");
  writer.pair(0, "ENDSEC");

  // TABLES: слои
  writer.pair(0, "SECTION");
  writer.pair(2, "TABLES");
  writer.pair(0, "TABLE");
  writer.pair(2, "LAYER");
  writer.pair(70, String(LAYERS.length));
  for (const layer of LAYERS) {
    writer.pair(0, "LAYER");
    writer.pair(2, layer);
    writer.pair(70, "0");
    writer.pair(62, "7");
    writer.pair(6, "CONTINUOUS");
  }
  writer.pair(0, "ENDTAB");
  writer.pair(0, "ENDSEC");

  // ENTITIES
  writer.pair(0, "SECTION");
  writer.pair(2, "ENTITIES");

  for (const wall of derived.wallPolygons) {
    writer.polygon("WALLS", wall.polygon);
  }

  // Проёмы: две коробки-щеки поперёк стены на границах проёма. Порог и
  // высота — не плановая информация, в план они не пишутся.
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]));
  for (const opening of document.openings) {
    const wall = document.walls.find((candidate) => candidate.id === opening.parentWallId);
    if (!wall) continue;
    const start = nodeById.get(wall.startNodeId);
    const end = nodeById.get(wall.endNodeId);
    if (!start || !end) continue;
    const length = Math.hypot(end.xMm - start.xMm, end.yMm - start.yMm);
    if (length === 0) continue;
    const direction = {
      xMm: (end.xMm - start.xMm) / length,
      yMm: (end.yMm - start.yMm) / length,
    };
    const normal = { xMm: -direction.yMm, yMm: direction.xMm };
    const half = wall.thicknessMm / 2;
    const jambAt = (along: number): [Point, Point] => {
      const base = {
        xMm: start.xMm + direction.xMm * along,
        yMm: start.yMm + direction.yMm * along,
      };
      return [
        { xMm: base.xMm - normal.xMm * half, yMm: base.yMm - normal.yMm * half },
        { xMm: base.xMm + normal.xMm * half, yMm: base.yMm + normal.yMm * half },
      ];
    };
    const [nearLeft, nearRight] = jambAt(opening.offsetMm);
    const [farLeft, farRight] = jambAt(opening.offsetMm + opening.widthMm);
    writer.line("OPENINGS", nearLeft, nearRight);
    writer.line("OPENINGS", farLeft, farRight);
    // Осевая проёма — чтобы в чужом CAD span читался с одного взгляда.
    writer.line(
      "OPENINGS",
      {
        xMm: (nearLeft.xMm + nearRight.xMm) / 2,
        yMm: (nearLeft.yMm + nearRight.yMm) / 2,
      },
      {
        xMm: (farLeft.xMm + farRight.xMm) / 2,
        yMm: (farLeft.yMm + farRight.yMm) / 2,
      },
    );
  }

  for (const column of document.columns) {
    writer.polygon(
      "COLUMNS",
      rotatedRect(
        { xMm: column.xMm, yMm: column.yMm },
        column.widthMm,
        column.depthMm,
        column.rotationDeg,
      ),
    );
  }

  for (const object of document.objects) {
    writer.polygon(
      "OBJECTS",
      rotatedRect(
        { xMm: object.xMm, yMm: object.yMm },
        object.widthMm,
        object.depthMm,
        object.rotationDeg,
      ),
    );
    writer.text("LABELS", { xMm: object.xMm, yMm: object.yMm }, 200, object.label || object.id);
  }

  writer.pair(0, "ENDSEC");
  writer.pair(0, "EOF");
  return writer.serialize();
}
