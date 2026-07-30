import { compareCodePoints, type JsonValue } from "../../index";

function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new TypeError("Canonical workflow JSON accepts only finite numbers.");
  }
  return Object.is(value, -0) ? "0" : JSON.stringify(value);
}

/**
 * Deterministic JSON used as the input to the injected SHA-256 (or equivalent)
 * command digester. Object keys use the frozen domain code-point comparator;
 * array order remains semantically significant.
 */
export function canonicalizeWorkflowCommand(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return canonicalNumber(value);
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) {
        throw new TypeError("Canonical workflow JSON does not accept sparse arrays.");
      }
      items.push(canonicalizeWorkflowCommand(value[index]!));
    }
    return `[${items.join(",")}]`;
  }

  const entries = Object.keys(value)
    .sort(compareCodePoints)
    .map((key) => `${JSON.stringify(key)}:${canonicalizeWorkflowCommand(value[key]!)}`);
  return `{${entries.join(",")}}`;
}

export function workflowJsonEqual(left: JsonValue, right: JsonValue): boolean {
  return canonicalizeWorkflowCommand(left) === canonicalizeWorkflowCommand(right);
}
