import { NextResponse, type NextRequest } from "next/server";
import {
  integrationGatewayDisabledResponse,
  integrationGatewayEnabled,
  IntegrationGatewayRequestError,
  IntegrationGatewayUnavailableError,
  consumeIntegrationWebhookBody,
  privateJsonHeaders,
} from "@/lib/integration-gateway/registry/http";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/integrations/[provider]/webhook">,
) {
  if (!integrationGatewayEnabled()) return integrationGatewayDisabledResponse();
  try {
    const { provider } = await context.params;
    if (!provider || provider !== "google_drive") throw new IntegrationGatewayRequestError("provider_not_supported");
    await consumeIntegrationWebhookBody(request);
    throw new IntegrationGatewayUnavailableError("provider_webhook_not_configured");
  } catch (error) {
    const code = error instanceof IntegrationGatewayRequestError ? "validation_failed" : "unsupported_source";
    const status = code === "validation_failed" ? 422 : 503;
    return NextResponse.json(
      { error: { code, messageKey: `integrations.errors.${error instanceof IntegrationGatewayUnavailableError ? error.reason : code}` } },
      { status, headers: privateJsonHeaders() },
    );
  }
}
