import { createHash } from "node:crypto";
import { compareCodePoints } from "../../index";

function canonicalize(value: unknown, ancestors: WeakSet<object>): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON requires finite numbers.");
    return JSON.stringify(value);
  }

  if (typeof value !== "object") {
    throw new TypeError(`Canonical JSON does not support ${typeof value} values.`);
  }

  if (ancestors.has(value)) throw new TypeError("Canonical JSON does not support cyclic values.");
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      const propertyNames = Object.getOwnPropertyNames(value);
      if (
        propertyNames.length !== value.length + 1
        || !propertyNames.includes("length")
        || Object.getOwnPropertySymbols(value).length > 0
      ) {
        throw new TypeError("Canonical JSON requires dense arrays without named properties.");
      }

      const entries: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw new TypeError("Canonical JSON requires dense data-property array elements.");
        }
        entries.push(canonicalize(descriptor.value, ancestors));
      }
      return `[${entries.join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON requires plain objects.");
    }

    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort(compareCodePoints)
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key], ancestors)}`);
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

/** RFC-8259 JSON with recursive Unicode-code-point object-key ordering. Arrays preserve order. */
export function canonicalJson(value: unknown): string {
  return canonicalize(value, new WeakSet<object>());
}

/** Semantic SHA-256 over the UTF-8 bytes of {@link canonicalJson}. */
export function semanticSha256(value: unknown): `sha256:${string}` {
  const digest = createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
  return `sha256:${digest}`;
}
