import type {
  FoundationEnvelope,
  FoundationErrorCode,
  RpcErrorLike,
} from "./contracts";
import { FOUNDATION_CONTRACT_VERSION } from "./contracts";

const SQLSTATE_TO_FOUNDATION: Readonly<Record<string, FoundationErrorCode>> = {
  "28000": "unauthenticated",
  "42501": "forbidden",
  "P1001": "unauthenticated",
  "P1002": "forbidden",
  "P1003": "not_found",
  "P1004": "stale_state",
  "P1005": "stale_state",
  "P1006": "stale_state",
  "P1007": "idempotency_conflict",
  "P1008": "validation_failed",
  "P1009": "scope_conflict",
  "P1010": "validation_failed",
  "P1011": "validation_failed",
  "P1101": "unauthenticated",
  "P1102": "identity_unverified",
  "P1103": "forbidden",
  "P1104": "not_found",
  "P1105": "expired",
  "P1106": "revoked",
  "P1107": "stale_state",
  "P1108": "idempotency_conflict",
  "P1109": "scope_conflict",
  "P1110": "unsupported_source",
  "P1111": "validation_failed",
  "P1112": "internal_error",
  "P2001": "identity_unverified",
  "P2002": "expired",
  "P2003": "revoked",
  "P2004": "unsupported_source",
};

const MESSAGE_CODE_TO_FOUNDATION: Readonly<Record<string, FoundationErrorCode>> = {
  ACCESS_DENIED: "forbidden",
  DOMAIN_CONTRACT_VIOLATION: "validation_failed",
  EVIDENCE_ACK_REQUIRED: "validation_failed",
  IDEMPOTENCY_CONFLICT: "idempotency_conflict",
  IDENTITY_UNVERIFIED: "identity_unverified",
  INVITATION_EXPIRED: "expired",
  INVITATION_REVOKED: "revoked",
  PROJECT_NOT_FOUND: "not_found",
  PROJECT_SCOPE_VIOLATION: "scope_conflict",
  REVISION_STALE: "stale_state",
  STATE_STALE: "stale_state",
  UNSUPPORTED_SOURCE: "unsupported_source",
  VERSION_STALE: "stale_state",
};

function stableMessageCode(error: RpcErrorLike): string | null {
  const message = error.message ?? "";
  const match = message.match(
    /\b(ACCESS_DENIED|DOMAIN_CONTRACT_VIOLATION|EVIDENCE_ACK_REQUIRED|IDEMPOTENCY_CONFLICT|IDENTITY_UNVERIFIED|INVITATION_EXPIRED|INVITATION_REVOKED|PROJECT_NOT_FOUND|PROJECT_SCOPE_VIOLATION|REVISION_STALE|STATE_STALE|UNSUPPORTED_SOURCE|VERSION_STALE)\b/,
  );
  return match?.[1] ?? null;
}

export class ProjectIntelligenceAdapterError extends Error {
  readonly code: FoundationErrorCode;
  readonly sqlstate: string | null;

  constructor(code: FoundationErrorCode, sqlstate: string | null) {
    super(`project_ceo.${code}`);
    this.name = "ProjectIntelligenceAdapterError";
    this.code = code;
    this.sqlstate = sqlstate;
  }
}

export function mapRpcError(error: RpcErrorLike): ProjectIntelligenceAdapterError {
  const sqlstate = error.code ?? null;
  const messageCode = stableMessageCode(error);
  const code =
    (sqlstate ? SQLSTATE_TO_FOUNDATION[sqlstate] : undefined) ??
    (messageCode ? MESSAGE_CODE_TO_FOUNDATION[messageCode] : undefined) ??
    "internal_error";

  return new ProjectIntelligenceAdapterError(code, sqlstate);
}

export function errorEnvelope(
  requestId: string,
  error: ProjectIntelligenceAdapterError,
): FoundationEnvelope<never> {
  return {
    contractVersion: FOUNDATION_CONTRACT_VERSION,
    requestId,
    data: null,
    error: {
      code: error.code,
      messageKey: `project_ceo.error.${error.code}`,
    },
  };
}
