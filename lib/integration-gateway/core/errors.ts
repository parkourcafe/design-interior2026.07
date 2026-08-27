export const INTEGRATION_ERROR_CODES = [
  "unauthenticated",
  "forbidden",
  "not_found",
  "expired_or_consumed",
  "idempotency_conflict",
  "lease_conflict",
  "scope_conflict",
  "validation_failed",
  "provider_unavailable",
  "rate_limited",
  "internal_error",
] as const;

export type IntegrationErrorCode = (typeof INTEGRATION_ERROR_CODES)[number];

const SQLSTATE_TO_INTEGRATION: Readonly<Record<string, IntegrationErrorCode>> = {
  "28000": "unauthenticated",
  "42501": "forbidden",
  P1201: "unauthenticated",
  P1203: "forbidden",
  P1204: "not_found",
  P1205: "expired_or_consumed",
  P1208: "idempotency_conflict",
  P1209: "scope_conflict",
  P1210: "provider_unavailable",
  P1211: "validation_failed",
  P1212: "internal_error",
};

export class IntegrationGatewayError extends Error {
  readonly code: IntegrationErrorCode;
  readonly sqlstate: string | null;

  constructor(code: IntegrationErrorCode, sqlstate: string | null = null) {
    super(`remhaos.integration.${code}`);
    this.name = "IntegrationGatewayError";
    this.code = code;
    this.sqlstate = sqlstate;
  }
}

export interface RpcErrorLike {
  readonly code?: string | null;
}

export function mapIntegrationRpcError(error: RpcErrorLike): IntegrationGatewayError {
  const sqlstate = error.code ?? null;
  return new IntegrationGatewayError(
    sqlstate ? SQLSTATE_TO_INTEGRATION[sqlstate] ?? "internal_error" : "internal_error",
    sqlstate,
  );
}
