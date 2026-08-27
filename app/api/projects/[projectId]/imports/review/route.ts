import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createProjectCeoRequestContext } from "@/lib/project-intelligence/delivery/projectceo/request-context";
import { IntegrationConnectionService } from "@/lib/integration-gateway/registry/connection-service";
import {
  assertIntegrationMutation,
  integrationGatewayDisabledResponse,
  integrationGatewayEnabled,
  integrationGatewayErrorResponse,
  integrationGatewayIdempotencyKey,
  integrationProjectIdPattern,
  IntegrationGatewayRequestError,
  parseIntegrationJson,
  privateJsonHeaders,
} from "@/lib/integration-gateway/registry/http";

export const dynamic = "force-dynamic";

const reviewBodySchema = z.object({
  candidateId: z.string().uuid(),
  decision: z.enum(["accepted", "rejected"]),
  target: z.object({
    targetKind: z.enum(["source", "reference", "selection", "evidence", "other"]).optional(),
    reason: z.string().trim().max(512).optional(),
  }).strict().default({}),
}).strict();

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/projects/[projectId]/imports/review">,
) {
  if (!integrationGatewayEnabled()) return integrationGatewayDisabledResponse();
  try {
    assertIntegrationMutation(request);
    const { projectId } = await context.params;
    if (!integrationProjectIdPattern.test(projectId)) throw new IntegrationGatewayRequestError();
    const body = reviewBodySchema.safeParse(await parseIntegrationJson(request));
    if (!body.success) throw new IntegrationGatewayRequestError();
    const idempotencyKey = integrationGatewayIdempotencyKey(request);
    const requestContext = await createProjectCeoRequestContext();
    const data = await new IntegrationConnectionService(requestContext.client)
      .reviewImportCandidate({ candidateId: body.data.candidateId, decision: body.data.decision, target: body.data.target, idempotencyKey });
    return NextResponse.json({ data }, { headers: privateJsonHeaders() });
  } catch (error) {
    return integrationGatewayErrorResponse(error);
  }
}
