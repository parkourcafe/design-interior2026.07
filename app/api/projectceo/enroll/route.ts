import { NextResponse } from "next/server";
import { z } from "zod";
import {
  FoundationPostgresAdapter,
  ProjectIntelligenceAdapterError,
} from "@/lib/project-intelligence/adapters/postgres";
import { isSameOriginMutation } from "@/lib/project-intelligence/delivery/projectceo/csrf";
import { projectCeoHttpStatus } from "@/lib/project-intelligence/delivery/projectceo/http-status";
import {
  createProjectCeoRequestContext,
  ProjectCeoAuthenticationError,
} from "@/lib/project-intelligence/delivery/projectceo/request-context";
import { isProjectCeoLocalFixtureMode } from "@/lib/project-intelligence/delivery/projectceo/server-port";

export const dynamic = "force-dynamic";

export const PROJECTCEO_ENROLL_CONTRACT_VERSION = "projectceo-enroll/0.1" as const;

const enrollSchema = z.object({
  contractVersion: z.literal(PROJECTCEO_ENROLL_CONTRACT_VERSION),
  projectId: z.string().uuid(),
}).strict();

const headers = { "Cache-Control": "private, no-store" };

function errorBody(requestId: string, code: string) {
  return {
    contractVersion: PROJECTCEO_ENROLL_CONTRACT_VERSION,
    requestId,
    status: code === "operation_unavailable" ? "unavailable" : "error",
    error: {
      code,
      messageKey: `project_ceo.error.${code}`,
      retryable: code === "internal_error",
    },
  } as const;
}

/**
 * Enrolment accepts only a legacy project identifier. The database derives the
 * current human, organization and owner scope from the request JWT; callers
 * cannot select an organization, actor, role or idempotency key.
 */
export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  if (!isSameOriginMutation(request)) {
    return NextResponse.json(errorBody(requestId, "forbidden"), { status: 403, headers });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json(errorBody(requestId, "validation_failed"), { status: 415, headers });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(errorBody(requestId, "validation_failed"), { status: 400, headers });
  }
  const parsed = enrollSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(errorBody(requestId, "validation_failed"), { status: 400, headers });
  }
  if (isProjectCeoLocalFixtureMode()) {
    return NextResponse.json(errorBody(requestId, "operation_unavailable"), { status: 409, headers });
  }
  try {
    const context = await createProjectCeoRequestContext();
    const mutation = await new FoundationPostgresAdapter(context.client).enrollOrganizationProject({
      projectId: parsed.data.projectId,
      idempotencyKey: `ui:enroll:${context.identity.userId}:${parsed.data.projectId}`,
    });
    return NextResponse.json({
      contractVersion: PROJECTCEO_ENROLL_CONTRACT_VERSION,
      requestId,
      status: "completed",
      operation: mutation.operation,
      replay: mutation.replay,
      stateRevision: mutation.stateRevision,
      result: mutation.result,
    }, { status: 200, headers });
  } catch (error) {
    const code = error instanceof ProjectCeoAuthenticationError
      ? error.code
      : error instanceof ProjectIntelligenceAdapterError
        ? error.code
        : "internal_error";
    return NextResponse.json(errorBody(requestId, code), {
      status: projectCeoHttpStatus(code),
      headers,
    });
  }
}
