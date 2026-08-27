import { NextResponse, type NextRequest } from "next/server";
import { sha256Hex } from "@/lib/integration-gateway/core/oauth-intent";
import { createIntegrationWorkerClient } from "@/lib/integration-gateway/runtime/worker-client";
import { createGoogleDriveOAuthFlow } from "@/lib/integration-gateway/google-drive/runtime";
import {
  GoogleDriveOAuthConfigurationError,
  GoogleDriveOAuthProtocolError,
} from "@/lib/integration-gateway/google-drive/oauth";
import { GoogleDriveOAuthFlowError } from "@/lib/integration-gateway/google-drive/oauth-flow";
import {
  integrationGatewayDisabledResponse,
  integrationGatewayEnabled,
  IntegrationGatewayRequestError,
  integrationGatewayErrorResponse,
  privateJsonHeaders,
} from "@/lib/integration-gateway/registry/http";
import { SecretStoreUnavailableError } from "@/lib/integration-gateway/core/secret-store";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
context: { params: Promise<{ provider: string }> },
) {
  if (!integrationGatewayEnabled()) return integrationGatewayDisabledResponse();
  const { provider } = await context.params;
  if (!provider || provider.length > 64) {
    return NextResponse.json(
      { error: { code: "not_found", messageKey: "integrations.errors.notFound" } },
      { status: 404, headers: privateJsonHeaders() },
    );
  }
  if (provider !== "google_drive") {
    return NextResponse.json(
      { error: { code: "not_found", messageKey: "integrations.errors.notFound" } },
      { status: 404, headers: privateJsonHeaders() },
    );
  }
  try {
    const callbackUrl = new URL(request.url);
    const state = callbackUrl.searchParams.get("state") ?? "missing-state";
    const codeOrError = callbackUrl.searchParams.get("code")
      ?? callbackUrl.searchParams.get("error")
      ?? "missing-result";
    const flow = createGoogleDriveOAuthFlow({
      client: createIntegrationWorkerClient(),
    });
    const data = await flow.complete({
      callbackUrl,
      idempotencyKey: `google-drive-callback-${sha256Hex(state)}-${sha256Hex(codeOrError)}`,
    });
    return NextResponse.json({ data }, { headers: privateJsonHeaders() });
  } catch (error) {
    if (error instanceof GoogleDriveOAuthConfigurationError || error instanceof SecretStoreUnavailableError) {
      return NextResponse.json(
        { error: { code: "unsupported_source", messageKey: "integrations.errors.oauthTransportNotConfigured" } },
        { status: 503, headers: privateJsonHeaders() },
      );
    }
    if (error instanceof GoogleDriveOAuthFlowError || error instanceof GoogleDriveOAuthProtocolError) {
      return integrationGatewayErrorResponse(new IntegrationGatewayRequestError("oauth_callback_invalid"));
    }
    return integrationGatewayErrorResponse(error);
  }
}
