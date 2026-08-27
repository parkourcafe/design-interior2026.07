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

const unbindBodySchema = z.object({
  projectConnectionId: z.string().uuid(),
  reason: z.string().trim().min(1).max(512),
}).strict();

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/projects/[projectId]/connections/unbind">,
) {
  if (!integrationGatewayEnabled()) return integrationGatewayDisabledResponse();
  try {
    assertIntegrationMutation(request);
    const { projectId } = await context.params;
    if (!integrationProjectIdPattern.test(projectId)) throw new IntegrationGatewayRequestError();
    const body = unbindBodySchema.safeParse(await parseIntegrationJson(request));
    if (!body.success) throw new IntegrationGatewayRequestError();
    const idempotencyKey = integrationGatewayIdempotencyKey(request);
    const requestContext = await createProjectCeoRequestContext();
    const data = await new IntegrationConnectionService(requestContext.client)
      .unbindProjectConnection({ projectConnectionId: body.data.projectConnectionId, reason: body.data.reason, idempotencyKey });
    return NextResponse.json({ data }, { headers: privateJsonHeaders() });
  } catch (error) {
    return integrationGatewayErrorResponse(error);
  }
}
