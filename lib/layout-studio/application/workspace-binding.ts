import type { LayoutDocument } from "@/lib/layout-studio/domain";

/**
 * Привязка планировки к рабочему пространству объединённого контура.
 *
 * Черновики живут в мире студии (таблица layout_documents, тенантность через
 * public.projects), а подписанные версии — в мире projectceo (организация →
 * проект → пакет). Это две разные таблицы проектов, и моста между ними нет.
 * Привязка — и есть мост: она говорит, в какой пакет какого projectceo-проекта
 * публикуются версии этой планировки.
 *
 * Комнат и вариантов как реестра в projectceo не существует: roomId и
 * variantId — свободные идентификаторы, и первая публикация с ними и есть
 * создание scope (first-publication semantics, зафиксировано контрактным
 * тестом m2-layout-version-command.contract.test.ts). Поэтому roomId минтится
 * редактором из названия планировки один раз при привязке и дальше хранится:
 * если бы он каждый раз выводился из названия заново, переименование
 * планировки молча увело бы публикации в «новую комнату».
 */
export interface WorkspaceBinding {
  /** projectceo-проект (uuid). Не путать с public.projects студии. */
  readonly projectId: string;
  /** Пакет внутри projectceo-проекта (uuid). */
  readonly packageId: string;
  /** Идентификатор комнаты в scope пакета. Минтится при привязке. */
  readonly roomId: string;
  /** Роль варианта в комнате. Первая публикация комнаты — preferred. */
  readonly role: WorkspaceVariantRole;
}

export const WORKSPACE_VARIANT_ROLES = ["preferred", "value_engineered", "premium"] as const;
export type WorkspaceVariantRole = (typeof WORKSPACE_VARIANT_ROLES)[number];

/**
 * Тот же алфавит, что закреплён для id сущностей документа
 * (id-charset-contract.test.ts), с длиной до 160 — лимита commitM2Identifier
 * на стороне команды публикации. Один алфавит на всю систему дешевле навсегда,
 * чем три почти одинаковых.
 */
export const ROOM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{2,159}$/;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Транслитерация для минта roomId из русского названия комнаты. */
const TRANSLIT: Readonly<Record<string, string>> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh",
  щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/**
 * Предложить roomId из названия планировки.
 *
 * Детерминированно: одно название — один результат. Если после транслитерации
 * и чистки не остаётся допустимого идентификатора (название из одних эмодзи,
 * пустое, слишком короткое) — честный фолбэк `room-<seed>`, а не исключение:
 * это предложение по умолчанию, дизайнер может поправить руками.
 */
export function mintRoomId(title: string, fallbackSeed: string): string {
  const transliterated = [...title.toLowerCase()]
    .map((character) => {
      if (/[a-z0-9]/.test(character)) return character;
      if (character in TRANSLIT) return TRANSLIT[character];
      if (/\s/.test(character)) return "-";
      if ("._:@-".includes(character)) return character;
      return "";
    })
    .join("")
    .replace(/-{2,}/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 160)
    .replace(/[^a-z0-9]+$/, "");

  if (ROOM_ID_PATTERN.test(transliterated)) return transliterated;

  const seed = fallbackSeed.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
  return `room-${seed.length > 0 ? seed : "unnamed"}`;
}

/**
 * Разобрать привязку из неструктурированного значения (тело запроса, колонки
 * строки БД). null — не «ошибка», а «привязки нет»: непривязанная планировка
 * — нормальное состояние до первой публикации.
 */
export function parseWorkspaceBinding(value: unknown): WorkspaceBinding | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const { projectId, packageId, roomId, role } = record;
  if (
    typeof projectId !== "string" || !UUID_PATTERN.test(projectId) ||
    typeof packageId !== "string" || !UUID_PATTERN.test(packageId) ||
    typeof roomId !== "string" || !ROOM_ID_PATTERN.test(roomId) ||
    typeof role !== "string" ||
    !(WORKSPACE_VARIANT_ROLES as readonly string[]).includes(role)
  ) {
    return null;
  }
  return { projectId, packageId, roomId, role: role as WorkspaceVariantRole };
}

/**
 * Подготовить публикационную копию черновика.
 *
 * Команда публикации требует, чтобы layoutContent.projectId совпадал с
 * projectceo-проектом команды, а variant.status был "published" — оба
 * требования зашиты в её схему (.strict() + superRefine). Черновик же несёт
 * studio-идентификатор проекта и живой статус варианта. Преобразование
 * происходит здесь, в одном месте, чистой функцией: черновик не мутируется,
 * подпись считается уже по преобразованному содержимому.
 */
export function prepareForPublication(
  draft: LayoutDocument,
  binding: WorkspaceBinding,
): LayoutDocument {
  const publication = structuredClone(draft);
  (publication as { projectId: string }).projectId = binding.projectId;
  (publication.variant as { status: string }).status = "published";
  return publication;
}
