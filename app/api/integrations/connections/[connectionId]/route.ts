import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createProjectCeoRequestContext } from "@/lib/project-intelligence/delivery/projectceo/request-context";
import { IntegrationConnectionService } from "@/lib/integration-gateway/registry/connection-service";
import { requireIntegrationOwner } from "@/lib/integration-gateway/registry/access";
import { revokeGoogleDriveConnectionIfConfigured } from "@/lib/integration-gateway/google-drive/runtime";
import {
  assertIntegrationMutation,
  integrationGatewayDisabledResponse,
  integrationGatewayEnabled,
  integrationGatewayErrorResponse,
  integrationGatewayIdempotencyKey,
  privateJsonHeaders,
  parseIntegrationJson,
  IntegrationGatewayRequestError,
} from "@/lib/integration-gateway/registry/http";

export const dynamic = "force-dynamic";

const disconnectBodySchema = z.object({ reason: z.string().trim().min(1).max(512) }).strict();

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/integrations/connections/[connectionId]">,
) {
  if (!integrationGatewayEnabled()) return integrationGatewayDisabledResponse();
  try {
    assertIntegrationMutation(request);
    const { connectionId } = await context.params;
    if (!z.string().uuid().safeParse(connectionId).success) throw new IntegrationGatewayRequestError();
    const body = disconnectBodySchema.safeParse(await parseIntegrationJson(request));
    if (!body.success) throw new IntegrationGatewayRequestError();
    const idempotencyKey = integrationGatewayIdempotencyKey(request);
    const contextValue = await createProjectCeoRequestContext();
    const service = new IntegrationConnectionService(contextValue.client);
    const owner = await requireIntegrationOwner();
    const connection = (await service.listOrganizationConnections(owner.organization.id))
      .find((item) => item.connectionId === connectionId);
    const externalRevoke = connection?.providerCode === "google_drive"
      ? await revokeGoogleDriveConnectionIfConfigured({
          actor: {
            actorId: owner.actor.actorId,
            organizationId: owner.organization.id,
            correlationId: crypto.randomUUID(),
            effectiveCapabilities: ["manage_project_integrations"],
          },
          connection: {
            connectionId,
            provider: "google_drive",
            organizationId: owner.organization.id,
          },
        })
      : "not_attempted" as const;
    const data = await service
      .disconnectOrganizationConnection({ connectionId, reason: body.data.reason, idempotencyKey });
    return NextResponse.json({ data, externalRevoke }, { headers: privateJsonHeaders() });
  } catch (error) {
    return integrationGatewayErrorResponse(error);
  }
}
