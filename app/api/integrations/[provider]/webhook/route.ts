import { NextResponse, type NextRequest } from "next/server";
import { createIntegrationWorkerClient } from "@/lib/integration-gateway/runtime/worker-client";
import {
  GoogleDriveWebhookProcessor,
  PostgresGoogleDriveWebhookResolver,
} from "@/lib/integration-gateway/google-drive/webhook";
import {
  integrationGatewayDisabledResponse,
  integrationGatewayEnabled,
  IntegrationGatewayRequestError,
  IntegrationGatewayUnavailableError,
  consumeIntegrationWebhookBody,
  integrationGatewayErrorResponse,
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
    let processor: GoogleDriveWebhookProcessor;
    try {
      processor = new GoogleDriveWebhookProcessor(
        new PostgresGoogleDriveWebhookResolver(createIntegrationWorkerClient()),
      );
    } catch {
      throw new IntegrationGatewayUnavailableError("provider_webhook_not_configured");
    }
    const data = await processor.process(new Headers(request.headers));
    return NextResponse.json({ data }, { status: 202, headers: privateJsonHeaders() });
  } catch (error) {
    if (error instanceof IntegrationGatewayUnavailableError) {
      return NextResponse.json(
        { error: { code: "unsupported_source", messageKey: `integrations.errors.${error.reason}` } },
        { status: 503, headers: privateJsonHeaders() },
      );
    }
    return integrationGatewayErrorResponse(error);
  }
}
