import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createProjectCeoRequestContext } from "@/lib/project-intelligence/delivery/projectceo/request-context";
import { TelegramBridgeService } from "@/lib/integration-gateway/telegram/service";
import {
  assertIntegrationMutation,
  integrationGatewayDisabledResponse,
  integrationGatewayEnabled,
  integrationGatewayErrorResponse,
  integrationGatewayIdempotencyKey,
  integrationProjectIdPattern,
  IntegrationGatewayRequestError,
  parseIntegrationJson,
  privateJsonHeaders,
} from "@/lib/integration-gateway/registry/http";

export const dynamic = "force-dynamic";

const reviewBodySchema = z.object({
  candidateId: z.string().uuid(),
  decision: z.enum(["accepted", "rejected"]),
  reason: z.string().trim().min(1).max(512),
}).strict();

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/projects/[projectId]/inbox/review">,
) {
  if (!integrationGatewayEnabled()) return integrationGatewayDisabledResponse();
  try {
    assertIntegrationMutation(request);
    const { projectId } = await context.params;
    if (!integrationProjectIdPattern.test(projectId)) throw new IntegrationGatewayRequestError();
    const body = reviewBodySchema.safeParse(await parseIntegrationJson(request));
    if (!body.success) throw new IntegrationGatewayRequestError();
    const idempotencyKey = integrationGatewayIdempotencyKey(request);
    const requestContext = await createProjectCeoRequestContext();
    const data = await new TelegramBridgeService(requestContext.client).reviewCandidate({
      projectId,
      candidateId: body.data.candidateId,
      decision: body.data.decision,
      reason: body.data.reason,
      idempotencyKey,
    });
    return NextResponse.json({ data }, { headers: privateJsonHeaders() });
  } catch (error) {
    return integrationGatewayErrorResponse(error);
  }
}
