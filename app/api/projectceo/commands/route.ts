import { NextResponse } from "next/server";
import {
  PROJECTCEO_COMMAND_CONTRACT_VERSION,
  projectCeoCommandSchema,
} from "@/lib/project-intelligence/delivery/projectceo/command-contract";
import { ProjectCeoCommandService } from "@/lib/project-intelligence/delivery/projectceo/command-service";
import { isSameOriginMutation } from "@/lib/project-intelligence/delivery/projectceo/csrf";
import {
  createProjectCeoRequestContext,
  PROJECTCEO_SESSION_PROVENANCE_HEADER,
  ProjectCeoAuthenticationError,
} from "@/lib/project-intelligence/delivery/projectceo/request-context";
import { isProjectCeoLocalFixtureMode } from "@/lib/project-intelligence/delivery/projectceo/server-port";
import { projectCeoHttpStatus } from "@/lib/project-intelligence/delivery/projectceo/http-status";

export const dynamic = "force-dynamic";

const MAX_COMMAND_BODY_BYTES = 96 * 1024;

function hasOversizedDeclaredBody(request: Request) {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength === null || !/^\d+$/.test(declaredLength)) return false;
  const declaredBytes = Number(declaredLength);
  return !Number.isSafeInteger(declaredBytes) || declaredBytes > MAX_COMMAND_BODY_BYTES;
}

async function readBoundedJsonBody(request: Request): Promise<
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly tooLarge: boolean }
> {
  if (request.body === null) {
    return { ok: false, tooLarge: false };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_COMMAND_BODY_BYTES) {
        await reader.cancel();
        return { ok: false, tooLarge: true };
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
  } catch {
    return { ok: false, tooLarge: false };
  } finally {
    reader.releaseLock();
  }
}

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
  if (hasOversizedDeclaredBody(request)) {
    void request.body?.cancel();
    return NextResponse.json(errorBody(requestId, "validation_failed"), { status: 413, headers });
  }
  const boundedBody = await readBoundedJsonBody(request);
  if (!boundedBody.ok) {
    return NextResponse.json(errorBody(requestId, "validation_failed"), {
      status: boundedBody.tooLarge ? 413 : 400,
      headers,
    });
  }
  const parsed = projectCeoCommandSchema.safeParse(boundedBody.value);
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
    return NextResponse.json(response, {
      status,
      headers: {
        ...headers,
        ...(context.identity.sessionDigest
          ? { [PROJECTCEO_SESSION_PROVENANCE_HEADER]: context.identity.sessionDigest }
          : {}),
      },
    });
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
