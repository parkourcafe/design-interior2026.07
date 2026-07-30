export function projectCeoHttpStatus(code: string): number {
  switch (code) {
    case "unauthenticated":
      return 401;
    case "identity_unverified":
    case "forbidden":
    case "expired":
    case "revoked":
      return 403;
    case "not_found":
      return 404;
    case "stale_state":
    case "idempotency_conflict":
    case "scope_conflict":
    case "operation_unavailable":
      return 409;
    case "unsupported_source":
    case "validation_failed":
      return 400;
    case "rate_limited":
      return 429;
    default:
      return 500;
  }
}
