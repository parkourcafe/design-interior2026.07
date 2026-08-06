import { NextResponse } from "next/server";
import {
  ProjectCeoAuthenticatedReadPostgresAdapter,
} from "@/lib/project-intelligence/adapters/postgres";
import { AUTHENTICATED_READ_CONTRACT_VERSION } from "@/lib/project-intelligence/adapters/postgres/authenticated-read";
import { ProjectIntelligenceAdapterError } from "@/lib/project-intelligence/adapters/postgres/errors";
import { projectCeoHttpStatus } from "@/lib/project-intelligence/delivery/projectceo/http-status";
import {
  createProjectCeoRequestContext,
  ProjectCeoAuthenticationError,
} from "@/lib/project-intelligence/delivery/projectceo/request-context";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" } as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteErrorCode =
  | "unauthenticated"
  | "identity_unverified"
  | "forbidden"
  | "not_found"
  | "validation_failed"
  | "internal_error";

function errorEnvelope(requestId: string, code: RouteErrorCode) {
  return {
    contractVersion: AUTHENTICATED_READ_CONTRACT_VERSION,
    requestId,
    data: null,
    error: {
      code,
      messageKey: `project_ceo.error.${code}`,
      retryable: code === "internal_error",
    },
    scope: null,
    stateRevision: null,
  } as const;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function controlledEnvelopeCode(value: unknown): RouteErrorCode | null {
  if (!isRecord(value) || !isRecord(value.error)) return null;
  const { code } = value.error;
  return code === "forbidden" || code === "not_found" || code === "validation_failed"
    ? code
    : null;
}

function successEnvelope(
  value: unknown,
  expected: {
    readonly projectId: string;
    readonly packageId: string | null;
  },
) {
  if (
    !isRecord(value)
    || value.contractVersion !== AUTHENTICATED_READ_CONTRACT_VERSION
    || typeof value.requestId !== "string"
    || !isRecord(value.data)
    || !Array.isArray(value.data.m2LayoutVersions)
    || !isRecord(value.scope)
    || (value.scope.accessScope !== "project" && value.scope.accessScope !== "package")
    || typeof value.scope.actorUserId !== "string"
    || typeof value.scope.organizationId !== "string"
    || typeof value.scope.projectId !== "string"
    || (value.scope.packageId !== null && typeof value.scope.packageId !== "string")
    || value.scope.projectId !== expected.projectId
    || (expected.packageId === null
      ? value.scope.accessScope !== "project" || value.scope.packageId !== null
      : value.scope.accessScope !== "package" || value.scope.packageId !== expected.packageId)
    || typeof value.stateRevision !== "number"
    || !Number.isSafeInteger(value.stateRevision)
    || value.stateRevision < 0
  ) {
    throw new Error("Invalid authenticated layout read envelope");
  }

  return {
    contractVersion: AUTHENTICATED_READ_CONTRACT_VERSION,
    requestId: value.requestId,
    data: { m2LayoutVersions: value.data.m2LayoutVersions },
    error: null,
    scope: {
      accessScope: value.scope.accessScope,
      actorUserId: value.scope.actorUserId,
      organizationId: value.scope.organizationId,
      packageId: value.scope.packageId,
      projectId: value.scope.projectId,
    },
    stateRevision: value.stateRevision,
  } as const;
}

export async function GET(
  request: Request,
  context: { readonly params: Promise<{ readonly projectId: string }> },
): Promise<NextResponse> {
  const requestId = crypto.randomUUID();
  const { projectId } = await context.params;
  const packageIds = new URL(request.url).searchParams.getAll("packageId");
  const packageId = packageIds[0];

  if (
    !uuidPattern.test(projectId)
    || packageIds.length > 1
    || (packageIds.length === 1 && (packageId === undefined || !uuidPattern.test(packageId)))
  ) {
    return NextResponse.json(errorEnvelope(requestId, "validation_failed"), {
      status: 400,
      headers,
    });
  }

  try {
    const requestContext = await createProjectCeoRequestContext();
    const adapter = new ProjectCeoAuthenticatedReadPostgresAdapter(requestContext.client);
    const requestedPackageId = packageId ?? null;
    const envelope = await adapter.getProjectWorkspaceRead({
      projectId,
      packageId: requestedPackageId,
    });
    const controlledCode = controlledEnvelopeCode(envelope);
    if (controlledCode !== null) {
      return NextResponse.json(errorEnvelope(requestId, controlledCode), {
        status: projectCeoHttpStatus(controlledCode),
        headers,
      });
    }
    return NextResponse.json(successEnvelope(envelope, {
      projectId,
      packageId: requestedPackageId,
    }), { status: 200, headers });
  } catch (error) {
    const code: RouteErrorCode = error instanceof ProjectCeoAuthenticationError
      ? error.code
      : error instanceof ProjectIntelligenceAdapterError
        && (error.code === "forbidden" || error.code === "not_found" || error.code === "validation_failed")
        ? error.code
        : "internal_error";
    return NextResponse.json(errorEnvelope(requestId, code), {
      status: projectCeoHttpStatus(code),
      headers,
    });
  }
}
