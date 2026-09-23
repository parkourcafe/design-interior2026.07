import { NextResponse } from "next/server";
import { z } from "zod";
import { ProjectCeoM3HumanPostgresAdapter } from "@/lib/project-intelligence/adapters/postgres/documentation";
import type { FoundationErrorCode } from "@/lib/project-intelligence/adapters/postgres/contracts";
import { ProjectIntelligenceAdapterError } from "@/lib/project-intelligence/adapters/postgres/errors";
import { isDocumentationModuleEnabled } from "@/lib/project-intelligence/delivery/projectceo/documentation-flag";
import { projectCeoHttpStatus } from "@/lib/project-intelligence/delivery/projectceo/http-status";
import {
  createProjectCeoRequestContext,
  PROJECTCEO_SESSION_PROVENANCE_HEADER,
  ProjectCeoAuthenticationError,
} from "@/lib/project-intelligence/delivery/projectceo/request-context";
import { isProjectCeoLocalFixtureMode } from "@/lib/project-intelligence/delivery/projectceo/server-port";

export const dynamic = "force-dynamic";

const CONTRACT_VERSION = "remhaos.native-m3-release-preview/1" as const;
const selectorSchema = z.object({
  projectId: z.string().uuid().transform(value => value.toLowerCase()),
  packageId: z.string().uuid().transform(value => value.toLowerCase()),
}).strict();

function errorEnvelope(requestId: string, code: FoundationErrorCode | "operation_unavailable") {
  return {
    contractVersion: CONTRACT_VERSION,
    requestId,
    data: null,
    error: {
      code,
      messageKey: `project_ceo.error.${code}`,
      retryable: code === "internal_error",
    },
  } as const;
}

export async function GET(
  _request: Request,
  routeContext: { readonly params: Promise<{ readonly projectId: string; readonly packageId: string }> },
): Promise<NextResponse> {
  const requestId = crypto.randomUUID();
  const headers: Record<string, string> = { "Cache-Control": "private, no-store" };
  if (!isDocumentationModuleEnabled()) {
    return NextResponse.json(errorEnvelope(requestId, "not_found"), { status: 404, headers });
  }

  try {
    if (isProjectCeoLocalFixtureMode()) {
      return NextResponse.json(errorEnvelope(requestId, "operation_unavailable"), { status: 409, headers });
    }
    const selector = selectorSchema.safeParse(await routeContext.params);
    if (!selector.success || selector.data.projectId === selector.data.packageId) {
      return NextResponse.json(errorEnvelope(requestId, "validation_failed"), { status: 400, headers });
    }

    const requestContext = await createProjectCeoRequestContext();
    if (requestContext.identity.sessionDigest) {
      headers[PROJECTCEO_SESSION_PROVENANCE_HEADER] = requestContext.identity.sessionDigest;
    }
    const adapter = new ProjectCeoM3HumanPostgresAdapter(requestContext.client);
    const { data: context } = await adapter.getNativeReleaseContext(selector.data);
    // Completeness only supplies the snapshot for a later human command; this
    // metadata read neither approves content nor publishes a release.
    const confirmation = context.structurallyComplete && context.baselineId !== null
      ? {
        packageId: context.scope.packageId,
        snapshotToken: context.contextDigest,
        expectedBaselineId: context.baselineId,
        expectedPreviousVersionId: context.previousVersionId,
        expectedStateRevision: context.stateRevision,
      }
      : null;
    return NextResponse.json({
      contractVersion: CONTRACT_VERSION,
      requestId,
      data: { context, confirmation },
      error: null,
    }, { status: 200, headers });
  } catch (error) {
    const code = error instanceof ProjectCeoAuthenticationError || error instanceof ProjectIntelligenceAdapterError
      ? error.code
      : "internal_error";
    return NextResponse.json(errorEnvelope(requestId, code), {
      status: projectCeoHttpStatus(code),
      headers,
    });
  }
}
