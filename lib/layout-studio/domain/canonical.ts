import type { LayoutDocument } from "./types";

const entityKeys = ["nodes", "walls", "openings", "columns", "objects", "clearanceZones", "materials", "materialAssignments", "lights"] as const;

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, sortObject(nested)]));
}

export function canonicalDocument(document: LayoutDocument): Record<string, unknown> {
  const clone = structuredClone(document) as LayoutDocument;
  clone.stateRevision = 0;
  for (const key of entityKeys) {
    (clone[key] as Array<{ id: string }>).sort((a, b) => a.id.localeCompare(b.id));
  }
  return sortObject(clone) as Record<string, unknown>;
}

export function canonicalJson(document: LayoutDocument): string {
  return JSON.stringify(canonicalDocument(document));
}

export async function semanticHash(document: LayoutDocument): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(document));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}
