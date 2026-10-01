// Комплект подрядчика уровня 1 (решение владельца 01.10.2026, вариант B).
// Что уходит исполнителю: принятое КП (версия, текст без стоимости), сводка
// паспорта без контактов и бюджета, исходные файлы плана и файлы клиента — и
// manifest с SHA-256 каждого. Чистые функции: сборка и проверка без сети.

import { createHash } from "node:crypto";
import type { AnswersMap, Passport, ProposalSection } from "@/lib/types";

export type KitFileKind = "designer_plan" | "client_file";

export interface KitFileSource {
  readonly kind: KitFileKind;
  readonly name: string;
  readonly path: string;
  readonly size: number | null;
  readonly contentType: string | null;
}

export interface ManifestEntry {
  readonly kind: "proposal" | "passport_summary" | KitFileKind;
  readonly name: string;
  readonly sha256: string;
  readonly size: number;
  readonly version?: number;
  readonly bucket?: "client-uploads";
  readonly path?: string;
  readonly contentType?: string | null;
}

export const KIT_BUCKET = "client-uploads" as const;
export const KIT_MAX_FILES = 30;

// Суммы в рублях: «233 000 ₽», «от 1 500 000 руб.», «2,5 млн ₽».
const MONEY_LINE = /\d[\d\s .,]*(?:\s?(?:тыс\.?|млн\.?|млрд\.?))?\s?(?:₽|руб)/iu;

/** Текст КП для подрядчика: без секции «Стоимость» и без строк с суммами. */
export function contractorProposalSections(sections: readonly ProposalSection[]): ProposalSection[] {
  return sections
    .filter((section) => section.id !== "price")
    .map((section) => ({
      id: section.id,
      title: section.title,
      body: section.body
        .split("\n")
        .filter((line) => !MONEY_LINE.test(line))
        .join("\n")
        .trim(),
    }))
    .filter((section) => section.body.length > 0);
}

/** Паспорт для подрядчика: без контактов, источника, бюджета, планов и болей семьи. */
export function contractorPassport(passport: Passport): Passport {
  return {
    ...passport,
    contact: undefined,
    source: undefined,
    vision: undefined,
    asset_horizon: "unknown",
    budget: { range: "undisclosed", risk_level: passport.budget.risk_level },
    pain_points: "",
    household: {
      now: "",
      in_5y: "",
      kids: passport.household.kids,
      pets: passport.household.pets,
    },
  };
}

function fileList(value: unknown, kind: KitFileKind): KitFileSource[] {
  if (!Array.isArray(value)) return [];
  const files: KitFileSource[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const { path, name, size, type } = item as { path?: unknown; name?: unknown; size?: unknown; type?: unknown };
    if (typeof path !== "string" || !path || path.includes("..")) continue;
    files.push({
      kind,
      name: typeof name === "string" && name ? name : path.split("/").pop() ?? path,
      path,
      size: typeof size === "number" ? size : null,
      contentType: typeof type === "string" ? type : null,
    });
  }
  return files;
}

/** Файлы проекта, которые уходят в комплект: план дизайнера и файлы клиента. */
export function kitFileSources(answers: AnswersMap, projectId: string): KitFileSource[] {
  const record = answers as Record<string, unknown>;
  const designer = fileList(record.designer_plan_attachments, "designer_plan")
    .filter((file) => file.path.startsWith(`designer-plans/${projectId}/`));
  const client = fileList(record.attachments, "client_file")
    .filter((file) => file.path.startsWith(`${projectId}/`));
  const seen = new Set<string>();
  return [...designer, ...client].filter((file) => {
    if (seen.has(file.path)) return false;
    seen.add(file.path);
    return true;
  }).slice(0, KIT_MAX_FILES);
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Детерминированное представление снимка для хеша (порядок ключей фиксирован). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function snapshotEntry(
  kind: "proposal" | "passport_summary",
  name: string,
  value: unknown,
  version?: number,
): ManifestEntry {
  const text = canonicalJson(value);
  return {
    kind,
    name,
    sha256: sha256Hex(text),
    size: Buffer.byteLength(text, "utf8"),
    ...(version === undefined ? {} : { version }),
  };
}

export function fileEntry(source: KitFileSource, bytes: Uint8Array): ManifestEntry {
  return {
    kind: source.kind,
    name: source.name,
    sha256: sha256Hex(bytes),
    size: bytes.byteLength,
    bucket: KIT_BUCKET,
    path: source.path,
    contentType: source.contentType,
  };
}

/** Проверка, что снимок в комплекте совпадает с хешем в manifest (на странице подрядчика). */
export function snapshotMatches(entry: ManifestEntry | undefined, value: unknown): boolean {
  return Boolean(entry) && sha256Hex(canonicalJson(value)) === entry!.sha256;
}
