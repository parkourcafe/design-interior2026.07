import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireIntegrationOwner } from "@/lib/integration-gateway/registry/access";
import { assertGoogleDriveScopes } from "@/lib/integration-gateway/google-drive/policy";
import {
  assertIntegrationMutation,
  integrationGatewayDisabledResponse,
  integrationGatewayEnabled,
  integrationGatewayErrorResponse,
  integrationGatewayIdempotencyKey,
  IntegrationGatewayRequestError,
  IntegrationGatewayUnavailableError,
  parseIntegrationJson,
  privateJsonHeaders,
} from "@/lib/integration-gateway/registry/http";

export const dynamic = "force-dynamic";

const connectIntentBodySchema = z.object({
  requestedScopes: z.array(z.string().min(1).max(256)).min(1).max(8),
}).strict();

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/integrations/[provider]/connect-intent">,
) {
  if (!integrationGatewayEnabled()) return integrationGatewayDisabledResponse();
  try {
    assertIntegrationMutation(request);
    const { provider } = await context.params;
    if (!provider || provider.length > 64) throw new IntegrationGatewayRequestError();
    const body = connectIntentBodySchema.safeParse(await parseIntegrationJson(request));
    if (!body.success) throw new IntegrationGatewayRequestError();
    if (provider !== "google_drive") {
      throw new IntegrationGatewayRequestError("provider_not_supported");
    }
    try {
      assertGoogleDriveScopes(body.data.requestedScopes);
    } catch {
      throw new IntegrationGatewayRequestError("scope_not_allowed");
    }
    integrationGatewayIdempotencyKey(request);
    await requireIntegrationOwner();
    throw new IntegrationGatewayUnavailableError("oauth_transport_not_configured");
  } catch (error) {
    return error instanceof IntegrationGatewayUnavailableError
      ? NextResponse.json(
        { error: { code: "unsupported_source", messageKey: "integrations.errors.oauthTransportNotConfigured" } },
        { status: 503, headers: privateJsonHeaders() },
      )
      : integrationGatewayErrorResponse(error);
  }
}
