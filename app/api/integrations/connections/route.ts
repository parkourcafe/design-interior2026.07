import { NextResponse, type NextRequest } from "next/server";
import { createProjectCeoRequestContext } from "@/lib/project-intelligence/delivery/projectceo/request-context";
import { IntegrationConnectionService } from "@/lib/integration-gateway/registry/connection-service";
import {
  integrationGatewayDisabledResponse,
  integrationGatewayEnabled,
  integrationGatewayErrorResponse,
  integrationProjectIdPattern,
  IntegrationGatewayRequestError,
  privateJsonHeaders,
} from "@/lib/integration-gateway/registry/http";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!integrationGatewayEnabled()) return integrationGatewayDisabledResponse();
  try {
    const organizationId = new URL(request.url).searchParams.get("organizationId")?.trim() ?? "";
    if (!integrationProjectIdPattern.test(organizationId)) {
      throw new IntegrationGatewayRequestError();
    }
    const context = await createProjectCeoRequestContext();
    const data = await new IntegrationConnectionService(context.client)
      .listOrganizationConnections(organizationId);
    return NextResponse.json({ data }, { headers: privateJsonHeaders() });
  } catch (error) {
    return integrationGatewayErrorResponse(error);
  }
}
