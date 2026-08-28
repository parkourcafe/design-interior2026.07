import { NextResponse } from "next/server";
import { z } from "zod";
import { ProjectCeoAuthenticationError } from "@/lib/project-intelligence/delivery/projectceo/request-context";
import { ProjectIntelligenceAdapterError } from "@/lib/project-intelligence/adapters/postgres/errors";
import { isSameOriginMutation } from "@/lib/project-intelligence/delivery/projectceo/csrf";
import { IntegrationGatewayRequestError } from "../registry/http";
import { FILE_INTAKE_MAX_REQUEST_BYTES, FileIntakePolicyError } from "./policy";

export class FileIntakeRequestError extends Error {
  constructor() {
    super("file_intake_request_validation_failed");
    this.name = "FileIntakeRequestError";
  }
}

export class FileIntakeForbiddenError extends Error {
  constructor() {
    super("file_intake_same_origin_required");
    this.name = "FileIntakeForbiddenError";
  }
}

export const fileIntakeProjectIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statuses: Readonly<Record<string, number>> = {
  unauthenticated: 401,
  identity_unverified: 401,
  forbidden: 403,
  not_found: 404,
  idempotency_conflict: 409,
  scope_conflict: 409,
  validation_failed: 422,
  unsupported_source: 422,
};

export function fileIntakeEnabled(): boolean {
  return process.env.REMHAOS_FILE_INTAKE_ENABLED === "true";
}

export function fileIntakeDisabledResponse(): NextResponse {
  return NextResponse.json(
    { error: { code: "not_found", messageKey: "fileIntake.errors.notFound" } },
    { status: 404, headers: { "Cache-Control": "private, no-store" } },
  );
}

export function fileIntakeErrorResponse(error: unknown): NextResponse {
  const code = error instanceof ProjectCeoAuthenticationError
    ? error.code
    : error instanceof FileIntakeForbiddenError
      ? "forbidden"
    : error instanceof z.ZodError
      || error instanceof SyntaxError
      || error instanceof IntegrationGatewayRequestError
      ? "validation_failed"
    : error instanceof FileIntakeRequestError
      ? "validation_failed"
    : error instanceof FileIntakePolicyError
      ? "validation_failed"
      : error instanceof ProjectIntelligenceAdapterError
        ? error.code
        : "internal_error";
  return NextResponse.json(
    { error: { code, messageKey: `project_ceo.error.${code}` } },
    { status: statuses[code] ?? 500, headers: { "Cache-Control": "private, no-store" } },
  );
}

export function fileIntakeIdempotencyKey(request: Request): string | null {
  const value = request.headers.get("Idempotency-Key")?.trim() ?? "";
  return value.length > 0 && value.length <= 512 ? value : null;
}

export function assertFileIntakeRequestSize(request: Request): void {
  const declaredLength = request.headers.get("content-length")?.trim();
  if (!declaredLength) return;
  const length = Number(declaredLength);
  if (
    !Number.isSafeInteger(length)
    || length < 0
    || length > FILE_INTAKE_MAX_REQUEST_BYTES
  ) {
    throw new FileIntakeRequestError();
  }
}

export function boundedFileIntakeRequest(
  request: Request,
  maxBytes = FILE_INTAKE_MAX_REQUEST_BYTES,
): Request {
  if (!request.body) return request;
  const reader = request.body.getReader();
  let total = 0;
  const boundedBody = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          controller.close();
          return;
        }
        total += chunk.value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          controller.error(new FileIntakeRequestError());
          return;
        }
        controller.enqueue(chunk.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
  return new Request(request, {
    body: boundedBody,
    duplex: "half",
  } as RequestInit & { readonly duplex: "half" });
}

export function assertFileIntakeMutation(request: Request): void {
  if (!isSameOriginMutation(request)) throw new FileIntakeForbiddenError();
}
