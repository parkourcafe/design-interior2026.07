import { NextResponse, type NextRequest } from "next/server";
import {
  integrationGatewayDisabledResponse,
  integrationGatewayEnabled,
  IntegrationGatewayUnavailableError,
  privateJsonHeaders,
} from "@/lib/integration-gateway/registry/http";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: RouteContext<"/api/integrations/[provider]/callback">,
) {
  if (!integrationGatewayEnabled()) return integrationGatewayDisabledResponse();
  const { provider } = await context.params;
  if (!provider || provider.length > 64) return NextResponse.json(
    { error: { code: "not_found", messageKey: "integrations.errors.notFound" } },
    { status: 404, headers: privateJsonHeaders() },
  );
  const error = new IntegrationGatewayUnavailableError("oauth_callback_not_configured");
  return NextResponse.json(
    { error: { code: "unsupported_source", messageKey: `integrations.errors.${error.reason}` } },
    { status: 503, headers: privateJsonHeaders() },
  );
}
