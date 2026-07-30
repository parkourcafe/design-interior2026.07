import { NextResponse } from "next/server";
import {
  PROJECTCEO_COMMAND_CONTRACT_VERSION,
  projectCeoCommandSchema,
} from "@/lib/project-intelligence/delivery/projectceo/command-contract";
import { ProjectCeoCommandService } from "@/lib/project-intelligence/delivery/projectceo/command-service";
import { isSameOriginMutation } from "@/lib/project-intelligence/delivery/projectceo/csrf";
import {
  createProjectCeoRequestContext,
  ProjectCeoAuthenticationError,
} from "@/lib/project-intelligence/delivery/projectceo/request-context";
import { isProjectCeoLocalFixtureMode } from "@/lib/project-intelligence/delivery/projectceo/server-port";
import { projectCeoHttpStatus } from "@/lib/project-intelligence/delivery/projectceo/http-status";

export const dynamic = "force-dynamic";

function errorBody(
  requestId: string,
  code: "unauthenticated" | "identity_unverified" | "forbidden" | "validation_failed" | "operation_unavailable" | "internal_error",
) {
  return {
    contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
    requestId,
    status: code === "operation_unavailable" ? "unavailable" : "error",
    error: {
      code,
      messageKey: `project_ceo.error.${code}`,
      retryable: code === "internal_error",
    },
  } as const;
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const headers = { "Cache-Control": "private, no-store" };
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
  const parsed = projectCeoCommandSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(errorBody(requestId, "validation_failed"), { status: 400, headers });
  }
  if (isProjectCeoLocalFixtureMode()) {
    return NextResponse.json(errorBody(requestId, "operation_unavailable"), { status: 409, headers });
  }
  try {
    const context = await createProjectCeoRequestContext();
    const service = new ProjectCeoCommandService({
      client: context.client,
      tokenSecret: process.env.PROJECTCEO_TOKEN_SECRET,
    });
    const response = await service.execute(parsed.data, requestId);
    const status = response.status === "completed"
      ? 200
      : projectCeoHttpStatus(response.error.code);
    return NextResponse.json(response, { status, headers });
  } catch (error) {
    const code = error instanceof ProjectCeoAuthenticationError
      ? error.code
      : "internal_error";
    return NextResponse.json(errorBody(requestId, code), {
      status: projectCeoHttpStatus(code),
      headers,
    });
  }
}
