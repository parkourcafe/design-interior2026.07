export const INTEGRATION_LOG_FIELDS = [
  "correlation_id",
  "provider_code",
  "connection_id",
  "organization_id",
  "project_id",
  "job_id",
  "event_type",
  "outcome_code",
  "duration_bucket",
  "attempt_count",
] as const;

export type IntegrationLogField = (typeof INTEGRATION_LOG_FIELDS)[number];

const FORBIDDEN_KEY = /(?:access|refresh|authorization)_?token|authorization_?code|signed_?url|callback_?url|raw_?query|provider_?object_?id|raw_?filename|message_?body|file_?contents|webhook_?body|email|phone|client_?pii|secret/i;

export type IntegrationLogMetadata = Partial<Record<IntegrationLogField, string | number>>;

export function sanitizeIntegrationLogMetadata(
  input: Readonly<Record<string, unknown>>,
): IntegrationLogMetadata {
  const metadata: Record<string, string | number> = {};
  for (const field of INTEGRATION_LOG_FIELDS) {
    const value = input[field];
    if (typeof value === "string" || typeof value === "number") {
      metadata[field] = value;
    }
  }
  for (const key of Object.keys(input)) {
    if (FORBIDDEN_KEY.test(key)) {
      throw new IntegrationGatewayLogError(key);
    }
  }
  return metadata;
}

export class IntegrationGatewayLogError extends Error {
  constructor(readonly field: string) {
    super("remhaos.integration.forbidden_log_field");
    this.name = "IntegrationGatewayLogError";
  }
}
