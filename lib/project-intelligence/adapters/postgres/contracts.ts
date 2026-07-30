import { z } from "zod";

export const FOUNDATION_CONTRACT_VERSION = "project-ceo-foundation/0.1" as const;

export const FOUNDATION_ERROR_CODES = [
  "unauthenticated",
  "identity_unverified",
  "forbidden",
  "not_found",
  "expired",
  "revoked",
  "stale_state",
  "idempotency_conflict",
  "scope_conflict",
  "unsupported_source",
  "validation_failed",
  "rate_limited",
  "internal_error",
] as const;

export type FoundationErrorCode = (typeof FOUNDATION_ERROR_CODES)[number];

export interface FoundationError {
  readonly code: FoundationErrorCode;
  readonly messageKey: string;
}

export interface FoundationEnvelope<T> {
  readonly contractVersion: typeof FOUNDATION_CONTRACT_VERSION;
  readonly requestId: string;
  readonly data: T | null;
  readonly error: FoundationError | null;
}

export interface CommandMutation<T> {
  readonly operation: string;
  readonly replay: boolean;
  readonly stateRevision: number;
  readonly result: T;
}

export interface RpcErrorLike {
  readonly code?: string | null;
  readonly message?: string | null;
  readonly details?: string | null;
  readonly hint?: string | null;
}

export interface RpcResponse {
  readonly data: unknown;
  readonly error: RpcErrorLike | null;
}

export interface RpcSchemaClient {
  rpc(
    functionName: string,
    args?: Readonly<Record<string, unknown>>,
  ): PromiseLike<RpcResponse>;
}

export interface PostgresRpcClient {
  schema(schemaName: string): RpcSchemaClient;
}

declare const postgresByteaBrand: unique symbol;
export type PostgresBytea = string & {
  readonly [postgresByteaBrand]: "postgres-bytea";
};

export const commandMutationSchema = z.object({
  operation: z.string().min(1),
  replay: z.boolean(),
  stateRevision: z.number().int().nonnegative().safe(),
  result: z.unknown(),
});

export const foundationEnvelopeSchema = z.object({
  contractVersion: z.literal(FOUNDATION_CONTRACT_VERSION),
  requestId: z.string().min(1),
  data: z.unknown().nullable(),
  error: z
    .object({
      code: z.enum(FOUNDATION_ERROR_CODES),
      messageKey: z.string().min(1),
    })
    .nullable(),
});

export function parseCommandMutation<T>(value: unknown): CommandMutation<T> {
  return commandMutationSchema.parse(value) as CommandMutation<T>;
}

export function parseFoundationEnvelope<T>(value: unknown): FoundationEnvelope<T> {
  const parsed = foundationEnvelopeSchema.parse(value);
  if ((parsed.data === null) === (parsed.error === null)) {
    throw new Error("Foundation envelope must contain exactly one of data or error");
  }
  return parsed as FoundationEnvelope<T>;
}
