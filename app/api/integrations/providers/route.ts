import { NextResponse } from "next/server";
import { createProjectCeoRequestContext } from "@/lib/project-intelligence/delivery/projectceo/request-context";
import {
  integrationGatewayDisabledResponse,
  integrationGatewayEnabled,
  integrationGatewayErrorResponse,
  privateJsonHeaders,
} from "@/lib/integration-gateway/registry/http";
import { IntegrationConnectionService } from "@/lib/integration-gateway/registry/connection-service";
import { requireIntegrationOwner } from "@/lib/integration-gateway/registry/access";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!integrationGatewayEnabled()) return integrationGatewayDisabledResponse();
  try {
    await requireIntegrationOwner();
    const context = await createProjectCeoRequestContext();
    const data = await new IntegrationConnectionService(context.client).listProviders();
    return NextResponse.json({ data }, { headers: privateJsonHeaders() });
  } catch (error) {
    return integrationGatewayErrorResponse(error);
  }
}
