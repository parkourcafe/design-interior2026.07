import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireIntegrationOwner } from "@/lib/integration-gateway/registry/access";
import { assertGoogleDriveScopes } from "@/lib/integration-gateway/google-drive/policy";
import { createGoogleDriveOAuthFlow } from "@/lib/integration-gateway/google-drive/runtime";
import { GoogleDriveOAuthConfigurationError } from "@/lib/integration-gateway/google-drive/oauth";
import { SecretStoreUnavailableError } from "@/lib/integration-gateway/core/secret-store";
import { createProjectCeoRequestContext } from "@/lib/project-intelligence/delivery/projectceo/request-context";
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
context: { params: Promise<{ provider: string }> },
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
    const idempotencyKey = integrationGatewayIdempotencyKey(request);
    const owner = await requireIntegrationOwner();
    let flow;
    try {
      const requestContext = await createProjectCeoRequestContext();
      flow = createGoogleDriveOAuthFlow({ client: requestContext.client });
    } catch (error) {
      if (error instanceof GoogleDriveOAuthConfigurationError || error instanceof SecretStoreUnavailableError) {
        throw new IntegrationGatewayUnavailableError("oauth_transport_not_configured");
      }
      throw error;
    }
    const data = await flow.start({
      organizationId: owner.organization.id,
      requestedScopes: body.data.requestedScopes,
      idempotencyKey,
    });
    return NextResponse.json({ data }, { status: 201, headers: privateJsonHeaders() });
  } catch (error) {
    return error instanceof IntegrationGatewayUnavailableError
      ? NextResponse.json(
        { error: { code: "unsupported_source", messageKey: "integrations.errors.oauthTransportNotConfigured" } },
        { status: 503, headers: privateJsonHeaders() },
      )
      : integrationGatewayErrorResponse(error);
  }
}
