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
  IntegrationGatewayRequestError,
  parseIntegrationJson,
  privateJsonHeaders,
} from "@/lib/integration-gateway/registry/http";

export const dynamic = "force-dynamic";

const disconnectBodySchema = z.object({ reason: z.string().trim().min(1).max(512) }).strict();

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  if (!integrationGatewayEnabled()) return integrationGatewayDisabledResponse();
  try {
    assertIntegrationMutation(request);
    const { provider: connectionId } = await context.params;
    if (!z.string().uuid().safeParse(connectionId).success) throw new IntegrationGatewayRequestError();
    const body = disconnectBodySchema.safeParse(await parseIntegrationJson(request));
    if (!body.success) throw new IntegrationGatewayRequestError();
    const idempotencyKey = integrationGatewayIdempotencyKey(request);
    const requestContext = await createProjectCeoRequestContext();
    const data = await new IntegrationConnectionService(requestContext.client)
      .disconnectOrganizationConnection({ connectionId, reason: body.data.reason, idempotencyKey });
    return NextResponse.json({ data }, { headers: privateJsonHeaders() });
  } catch (error) {
    return integrationGatewayErrorResponse(error);
  }
}
