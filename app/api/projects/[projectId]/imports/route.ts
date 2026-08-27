import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createProjectCeoRequestContext } from "@/lib/project-intelligence/delivery/projectceo/request-context";
import { IntegrationConnectionService } from "@/lib/integration-gateway/registry/connection-service";
import {
  assertIntegrationMutation,
  integrationGatewayDisabledResponse,
  integrationGatewayEnabled,
  integrationGatewayErrorResponse,
  integrationProjectIdPattern,
  IntegrationGatewayRequestError,
  IntegrationGatewayUnavailableError,
  parseIntegrationJson,
  privateJsonHeaders,
} from "@/lib/integration-gateway/registry/http";
import { assertSelectedGoogleDriveObject, googleDriveObjectSchema } from "@/lib/integration-gateway/google-drive/policy";

export const dynamic = "force-dynamic";

const importRequestSchema = z.object({
  providerCode: z.literal("google_drive"),
  projectConnectionId: z.string().uuid(),
  object: googleDriveObjectSchema,
}).strict();

export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/projects/[projectId]/imports">,
) {
  if (!integrationGatewayEnabled()) return integrationGatewayDisabledResponse();
  try {
    const { projectId } = await context.params;
    if (!integrationProjectIdPattern.test(projectId)) throw new IntegrationGatewayRequestError();
    const status = new URL(request.url).searchParams.get("status") ?? undefined;
    const requestContext = await createProjectCeoRequestContext();
    const data = await new IntegrationConnectionService(requestContext.client)
      .listImportCandidates(projectId, status);
    return NextResponse.json({ data }, { headers: privateJsonHeaders() });
  } catch (error) {
    return integrationGatewayErrorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/projects/[projectId]/imports">,
) {
  if (!integrationGatewayEnabled()) return integrationGatewayDisabledResponse();
  try {
    assertIntegrationMutation(request);
    const { projectId } = await context.params;
    if (!integrationProjectIdPattern.test(projectId)) throw new IntegrationGatewayRequestError();
    const body = importRequestSchema.safeParse(await parseIntegrationJson(request));
    if (!body.success) throw new IntegrationGatewayRequestError();
    assertSelectedGoogleDriveObject(body.data.object);
    await createProjectCeoRequestContext();
    throw new IntegrationGatewayUnavailableError("provider_worker_not_configured");
  } catch (error) {
    return integrationGatewayErrorResponse(error);
  }
}
