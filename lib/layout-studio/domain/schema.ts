import Ajv2020, { type ErrorObject } from "ajv/dist/2020";
import frozenSchema from "./layout-document-v0.1.schema.json";
import type { LayoutDocument, LayoutIssue } from "./types";

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validator = ajv.compile<LayoutDocument>(frozenSchema);

function issue(error: ErrorObject): LayoutIssue {
  return {
    code: error.keyword === "type" && error.params.type === "integer"
      ? "NON_INTEGER_DIMENSION"
      : "FROZEN_SCHEMA_INVALID",
    severity: "blocking",
    message: error.message ?? "Документ не соответствует frozen JSON Schema",
    path: error.instancePath || "/",
  };
}

export function validateFrozenLayoutSchema(value: unknown): { valid: boolean; issues: LayoutIssue[] } {
  const valid = validator(value);
  return { valid: Boolean(valid), issues: valid ? [] : (validator.errors ?? []).map(issue) };
}

export { frozenSchema };
