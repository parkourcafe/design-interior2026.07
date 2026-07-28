import { createHash } from "node:crypto";

function serializeCanonicalJson(value: unknown): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number": {
      if (!Number.isFinite(value)) {
        throw new TypeError("initial brief answers must contain finite numbers");
      }
      return JSON.stringify(value);
    }
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map(serializeCanonicalJson).join(",")}]`;
      }

      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError("initial brief answers must be plain JSON objects");
      }

      const object = value as Record<string, unknown>;
      const entries = Object.keys(object)
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${serializeCanonicalJson(object[key])}`,
        );
      return `{${entries.join(",")}}`;
    }
    default:
      throw new TypeError("initial brief answers must be valid JSON");
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function canonicalJsonStringify(value: unknown): string {
  return serializeCanonicalJson(value);
}

export function deriveInitialBriefRequestIdentity(
  projectId: string,
  answers: unknown,
): { answerDigest: string; idempotencyKey: string } {
  const answerDigest = sha256(canonicalJsonStringify(answers));
  const idempotencyKey = sha256(
    canonicalJsonStringify({ answerDigest, projectId }),
  );
  return { answerDigest, idempotencyKey };
}
