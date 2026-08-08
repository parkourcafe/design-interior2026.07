import { ENTITY_COLLECTIONS, entityArray, isRecord } from "./shared";
import type { LayoutDocument } from "./types";

const EPHEMERAL_FIELDS = new Set(["stateRevision", "updatedAt", "selection", "session"]);

// ADR-001: в канонизации запрещены локалезависимые сравнения. Подпись —
// свойство документа, а не машины: localeCompare зависит от локали и версии
// ICU, и один документ давал бы разные хеши на разных машинах. Сравнение —
// только по кодовым юнитам UTF-16. Запрет закреплён статически в
// canonical-signature.test.ts, контрольный хеш KORA-фикстуры — там же.
function byCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isRecord(value)) return value;

  const normalized: Record<string, unknown> = {};
  // Array.prototype.sort без компаратора и есть порядок кодовых юнитов;
  // компаратор передан явно, чтобы намерение читалось, а не угадывалось.
  for (const key of Object.keys(value).sort(byCodeUnits)) {
    if (EPHEMERAL_FIELDS.has(key) || value[key] === undefined) continue;
    normalized[key] = canonicalValue(value[key]);
  }
  return normalized;
}

export function canonicalSerialize(document: LayoutDocument): string {
  const normalized = structuredClone(document) as LayoutDocument;
  for (const collectionName of ENTITY_COLLECTIONS) {
    normalized[collectionName] = [...entityArray(normalized, collectionName)].sort((a, b) =>
      byCodeUnits(a.id, b.id),
    ) as never;
  }
  return JSON.stringify(canonicalValue(normalized));
}

export async function semanticHash(document: LayoutDocument): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalSerialize(document));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
