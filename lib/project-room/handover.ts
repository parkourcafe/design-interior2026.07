// Комплект подрядчика уровня 1 (решение владельца 01.10.2026, вариант B;
// подготовка и сверка — решение 02.10.2026, блокеры B-1/B-2).
// Что уходит исполнителю: текст КП, подготовленный дизайнером из принятой
// версии (без секции «Стоимость»; остальное дизайнер проверяет и правит сам),
// сводка паспорта без контактов и бюджета, выбранные дизайнером файлы
// (оригинал или безопасная копия) — и manifest с SHA-256 каждого переданного
// элемента. Чистые функции: сборка и проверка без сети.

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
  /** Для файла: передан оригинал или безопасная копия вместо него. */
  readonly variant?: FileVariant;
  /** Для безопасной копии: имя исходного файла, который она заменяет. */
  readonly sourceName?: string;
}

/** Решение дизайнера по файлу проекта. По умолчанию файл не передаётся. */
export type FileDecision = "exclude" | "original" | "needs_safe_copy" | "safe_copy";
export type FileVariant = "original" | "safe_copy";

export interface SafeCopy {
  readonly path: string;
  readonly name: string;
  readonly size: number | null;
  readonly content_type: string | null;
}

export interface DraftFile {
  readonly kind: KitFileKind;
  readonly source_path: string;
  readonly name: string;
  readonly size: number | null;
  readonly content_type: string | null;
  readonly decision: FileDecision;
  /** Дизайнер открыл и проверил то, что уйдёт (оригинал или копию). */
  readonly reviewed: boolean;
  readonly safe_copy?: SafeCopy;
}

/** Файл, который реально уходит исполнителю. */
export interface FinalFile {
  readonly kind: KitFileKind;
  readonly variant: FileVariant;
  readonly name: string;
  readonly path: string;
  readonly size: number | null;
  readonly contentType: string | null;
  readonly sourceName: string;
}

export const KIT_BUCKET = "client-uploads" as const;
export const KIT_MAX_FILES = 30;

/**
 * Начальный текст КП для исполнителя: принятая версия без секции «Стоимость».
 * Больше ничего не вырезается автоматически: суммы, бюджет и контакты в
 * свободном тексте дизайнер видит подсвеченными и убирает сам.
 */
export function contractorProposalSections(sections: readonly ProposalSection[]): ProposalSection[] {
  return sections
    .filter((section) => section.id !== "price")
    .map((section) => ({ id: section.id, title: section.title, body: section.body.trim() }))
    .filter((section) => section.body.length > 0);
}

/** Текст для исполнителя после правки дизайнером: пустые секции не уходят. */
export function normalizeContractorSections(sections: readonly ProposalSection[]): ProposalSection[] {
  return sections
    .map((section) => ({
      id: String(section.id),
      title: String(section.title).trim(),
      body: String(section.body).replace(/\r\n/g, "\n").trim(),
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

/** Черновик: все файлы проекта, по умолчанию — «не передавать». */
export function initialDraftFiles(sources: readonly KitFileSource[]): DraftFile[] {
  return sources.map((source) => ({
    kind: source.kind,
    source_path: source.path,
    name: source.name,
    size: source.size,
    content_type: source.contentType,
    decision: "exclude",
    reviewed: false,
  }));
}

const DECISIONS: readonly FileDecision[] = ["exclude", "original", "needs_safe_copy", "safe_copy"];

export function isFileDecision(value: unknown): value is FileDecision {
  return typeof value === "string" && (DECISIONS as readonly string[]).includes(value);
}

/**
 * Сохранённые решения поверх текущего списка файлов проекта: новые файлы
 * добавляются как «не передавать», исчезнувшие из проекта — убираются.
 */
export function mergeDraftFiles(stored: unknown, sources: readonly KitFileSource[]): DraftFile[] {
  const byPath = new Map<string, DraftFile>();
  if (Array.isArray(stored)) {
    for (const item of stored as DraftFile[]) {
      if (item && typeof item.source_path === "string" && isFileDecision(item.decision)) byPath.set(item.source_path, item);
    }
  }
  return initialDraftFiles(sources).map((fresh) => {
    const saved = byPath.get(fresh.source_path);
    return saved ? { ...fresh, decision: saved.decision, reviewed: saved.reviewed === true, ...(saved.safe_copy ? { safe_copy: saved.safe_copy } : {}) } : fresh;
  });
}

/** Окончательный список файлов комплекта — ровно то, что получит исполнитель. */
export function finalFiles(files: readonly DraftFile[]): FinalFile[] {
  const out: FinalFile[] = [];
  for (const file of files) {
    if (file.decision === "original") {
      out.push({ kind: file.kind, variant: "original", name: file.name, path: file.source_path, size: file.size, contentType: file.content_type, sourceName: file.name });
    } else if (file.decision === "safe_copy" && file.safe_copy) {
      out.push({ kind: file.kind, variant: "safe_copy", name: file.safe_copy.name, path: file.safe_copy.path, size: file.safe_copy.size, contentType: file.safe_copy.content_type, sourceName: file.name });
    }
  }
  return out;
}

export type HandoverBlocker =
  | { readonly code: "text_empty" }
  | { readonly code: "flags_unresolved"; readonly count: number }
  | { readonly code: "needs_safe_copy"; readonly names: readonly string[] }
  | { readonly code: "not_reviewed"; readonly names: readonly string[] };

/** Что мешает подтвердить сверку. Пустой список — можно подтверждать. */
export function handoverBlockers(input: {
  readonly sections: readonly ProposalSection[];
  readonly files: readonly DraftFile[];
  readonly unresolvedFlagCount: number;
}): HandoverBlocker[] {
  const blockers: HandoverBlocker[] = [];
  if (input.sections.length === 0) blockers.push({ code: "text_empty" });
  if (input.unresolvedFlagCount > 0) blockers.push({ code: "flags_unresolved", count: input.unresolvedFlagCount });
  const needCopy = input.files.filter((f) => f.decision === "needs_safe_copy" || (f.decision === "safe_copy" && !f.safe_copy)).map((f) => f.name);
  if (needCopy.length) blockers.push({ code: "needs_safe_copy", names: needCopy });
  const unreviewed = input.files.filter((f) => (f.decision === "original" || f.decision === "safe_copy") && !f.reviewed).map((f) => f.name);
  if (unreviewed.length) blockers.push({ code: "not_reviewed", names: unreviewed });
  return blockers;
}

/** Совпадает ли значение со снимком (паспорт после сверки или передачи). */
export function sameSnapshot(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
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

export function fileEntry(file: FinalFile, bytes: Uint8Array): ManifestEntry {
  return {
    kind: file.kind,
    name: file.name,
    sha256: sha256Hex(bytes),
    size: bytes.byteLength,
    bucket: KIT_BUCKET,
    path: file.path,
    contentType: file.contentType,
    variant: file.variant,
    ...(file.variant === "safe_copy" ? { sourceName: file.sourceName } : {}),
  };
}

/** Проверка, что снимок в комплекте совпадает с хешем в manifest (на странице подрядчика). */
export function snapshotMatches(entry: ManifestEntry | undefined, value: unknown): boolean {
  return Boolean(entry) && sha256Hex(canonicalJson(value)) === entry!.sha256;
}
