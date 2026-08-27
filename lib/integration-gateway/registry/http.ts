import "server-only";

import { NextResponse } from "next/server";
import { ProjectIntelligenceAdapterError } from "@/lib/project-intelligence/adapters/postgres/errors";
import { ProjectCeoAuthenticationError } from "@/lib/project-intelligence/delivery/projectceo/request-context";
import { isSameOriginMutation } from "@/lib/project-intelligence/delivery/projectceo/csrf";

export const integrationProjectIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const integrationGatewayJsonMaxBytes = 32 * 1024;
export const integrationGatewayWebhookMaxBytes = 64 * 1024;

export class IntegrationGatewayRequestError extends Error {
  constructor(readonly reason = "validation_failed") {
    super(`integration_gateway_${reason}`);
    this.name = "IntegrationGatewayRequestError";
  }
}

export class IntegrationGatewayForbiddenError extends Error {
  constructor(readonly reason = "same_origin_required") {
    super(`integration_gateway_${reason}`);
    this.name = "IntegrationGatewayForbiddenError";
  }
}

export class IntegrationGatewayUnavailableError extends Error {
  constructor(readonly reason = "external_staging_required") {
    super(`integration_gateway_${reason}`);
    this.name = "IntegrationGatewayUnavailableError";
  }
}

export function integrationGatewayEnabled(): boolean {
  return process.env.REMHAOS_INTEGRATIONS_ENABLED === "true";
}

export function integrationGatewayDisabledResponse(): NextResponse {
  return NextResponse.json(
    { error: { code: "not_found", messageKey: "integrations.errors.notFound" } },
    { status: 404, headers: { "Cache-Control": "private, no-store" } },
  );
}

export function integrationGatewayErrorResponse(error: unknown): NextResponse {
  const code = error instanceof ProjectCeoAuthenticationError
    ? error.code
    : error instanceof IntegrationGatewayForbiddenError
      ? "forbidden"
    : error instanceof IntegrationGatewayRequestError
      ? "validation_failed"
      : error instanceof IntegrationGatewayUnavailableError
        ? "unsupported_source"
        : error instanceof ProjectIntelligenceAdapterError
          ? error.code
          : "internal_error";
  const status = code === "unauthenticated" || code === "identity_unverified"
    ? 401
    : code === "forbidden"
      ? 403
      : code === "not_found"
        ? 404
        : code === "unsupported_source"
          ? 503
          : code === "idempotency_conflict" || code === "scope_conflict"
            ? 409
            : code === "validation_failed"
              ? 422
              : 500;
  const requestReason = error instanceof IntegrationGatewayRequestError
    && (error.reason === "provider_not_supported" || error.reason === "scope_not_allowed")
    ? error.reason
    : null;
  return NextResponse.json(
    { error: { code, messageKey: `integrations.errors.${requestReason ?? code}` } },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}

export function integrationGatewayIdempotencyKey(request: Request): string {
  const key = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (key.length < 1 || key.length > 512) {
    throw new IntegrationGatewayRequestError("idempotency_key_required");
  }
  return key;
}

export function assertIntegrationMutation(request: Request): void {
  if (!isSameOriginMutation(request)) {
    throw new IntegrationGatewayForbiddenError();
  }
}

async function readBoundedIntegrationText(
  request: Request,
  maxBytes: number,
): Promise<string> {
  const declaredLength = request.headers.get("content-length")?.trim();
  if (declaredLength) {
    const length = Number(declaredLength);
    if (
      !/^\d+$/u.test(declaredLength)
      || !Number.isSafeInteger(length)
      || length > maxBytes
    ) {
      throw new IntegrationGatewayRequestError("body_too_large");
    }
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes) {
        throw new IntegrationGatewayRequestError("body_too_large");
      }
      chunks.push(chunk.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new IntegrationGatewayRequestError("invalid_json");
  }
}

export async function parseIntegrationJson(
  request: Request,
  maxBytes = integrationGatewayJsonMaxBytes,
): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new IntegrationGatewayRequestError("json_content_type_required");
  }
  const raw = await readBoundedIntegrationText(request, maxBytes);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new IntegrationGatewayRequestError("invalid_json");
  }
}

export async function consumeIntegrationWebhookBody(request: Request): Promise<void> {
  const declaredLength = request.headers.get("content-length")?.trim();
  if (declaredLength) {
    const length = Number(declaredLength);
    if (
      !Number.isSafeInteger(length)
      || length < 0
      || length > integrationGatewayWebhookMaxBytes
    ) {
      throw new IntegrationGatewayRequestError("body_too_large");
    }
  }
  if (!request.body) return;
  const reader = request.body.getReader();
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return;
      total += chunk.value.byteLength;
      if (total > integrationGatewayWebhookMaxBytes) {
        throw new IntegrationGatewayRequestError("body_too_large");
      }
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export function privateJsonHeaders(): HeadersInit {
  return { "Cache-Control": "private, no-store" };
}
