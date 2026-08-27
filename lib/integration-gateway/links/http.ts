import { NextResponse } from "next/server";
import { ProjectIntelligenceAdapterError } from "@/lib/project-intelligence/adapters/postgres/errors";
import { isSameOriginMutation } from "@/lib/project-intelligence/delivery/projectceo/csrf";
import { IntegrationGatewayRequestError } from "../registry/http";
import { ProjectLinkUrlPolicyError } from "../core/url-policy";

export const projectIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const statusByCode: Readonly<Record<string, number>> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  idempotency_conflict: 409,
  scope_conflict: 409,
  validation_failed: 422,
};

export class ProjectLinksForbiddenError extends Error {
  constructor() {
    super("project_links_same_origin_required");
    this.name = "ProjectLinksForbiddenError";
  }
}

export const projectLinksJsonMaxBytes = 64 * 1024;

export function projectLinksEnabled(): boolean {
  return process.env.REMHAOS_PROJECT_LINKS_ENABLED === "true";
}

export function projectLinksDisabledResponse(): NextResponse {
  return NextResponse.json(
    { error: { code: "not_found", messageKey: "projectLinks.errors.notFound" } },
    { status: 404, headers: { "Cache-Control": "private, no-store" } },
  );
}

export function projectLinksErrorResponse(error: unknown): NextResponse {
  const code = error instanceof ProjectLinksForbiddenError
    ? "forbidden"
    : error instanceof ProjectLinkUrlPolicyError
      ? "validation_failed"
    : error instanceof ProjectIntelligenceAdapterError
      ? error.code
      : "internal_error";
  return NextResponse.json(
    { error: { code, messageKey: `project_ceo.error.${code}` } },
    {
      status: statusByCode[code] ?? 500,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}

export function idempotencyKey(request: Request): string | null {
  const value = request.headers.get("Idempotency-Key")?.trim() ?? "";
  return value.length > 0 && value.length <= 512 ? value : null;
}

export function assertProjectLinksMutation(request: Request): void {
  if (!isSameOriginMutation(request)) throw new ProjectLinksForbiddenError();
}

export function projectLinksRequestErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof IntegrationGatewayRequestError)) return null;
  return NextResponse.json(
    { error: { code: "validation_failed", messageKey: "projectLinks.errors.invalidRequest" } },
    {
      status: error.reason === "body_too_large" ? 413 : 400,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
