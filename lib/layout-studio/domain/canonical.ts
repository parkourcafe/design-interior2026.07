import { ENTITY_COLLECTIONS, entityArray, isRecord } from "./shared";
import type { LayoutDocument } from "./types";

const EPHEMERAL_FIELDS = new Set(["stateRevision", "updatedAt", "selection", "session"]);

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0)!);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0)!);
  const sharedLength = Math.min(leftPoints.length, rightPoints.length);

  for (let index = 0; index < sharedLength; index += 1) {
    const difference = leftPoints[index]! - rightPoints[index]!;
    if (difference !== 0) return difference;
  }

  return leftPoints.length - rightPoints.length;
}

export function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isRecord(value)) return value;

  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    if (EPHEMERAL_FIELDS.has(key) || value[key] === undefined) continue;
    normalized[key] = canonicalValue(value[key]);
  }
  return normalized;
}

export function canonicalSerialize(document: LayoutDocument): string {
  const normalized = structuredClone(document) as LayoutDocument;
  for (const collectionName of ENTITY_COLLECTIONS) {
    normalized[collectionName] = [...entityArray(normalized, collectionName)].sort((a, b) =>
      compareUnicodeCodePoints(a.id, b.id),
    ) as never;
  }
  return JSON.stringify(canonicalValue(normalized));
}

export async function semanticHash(document: LayoutDocument): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalSerialize(document));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
