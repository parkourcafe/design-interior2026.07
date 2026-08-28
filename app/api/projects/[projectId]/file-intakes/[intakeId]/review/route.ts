import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createProjectCeoRequestContext } from "@/lib/project-intelligence/delivery/projectceo/request-context";
import { FileIntakeService } from "@/lib/integration-gateway/file-intake/service";
import {
  fileIntakeDisabledResponse,
  fileIntakeEnabled,
  fileIntakeErrorResponse,
  fileIntakeIdempotencyKey,
  fileIntakeProjectIdPattern,
  assertFileIntakeMutation,
  FileIntakeRequestError,
} from "@/lib/integration-gateway/file-intake/http";
import { parseIntegrationJson } from "@/lib/integration-gateway/registry/http";

export const dynamic = "force-dynamic";
const bodySchema = z.object({
  decision: z.enum(["accepted", "rejected"]),
  reason: z.string().trim().min(1).max(2000),
}).strict();

export async function POST(
  request: NextRequest,
context: { params: Promise<{ projectId: string; intakeId: string }> },
) {
  if (!fileIntakeEnabled()) return fileIntakeDisabledResponse();
  try {
    assertFileIntakeMutation(request);
    const { projectId, intakeId } = await context.params;
    if (!fileIntakeProjectIdPattern.test(projectId) || !fileIntakeProjectIdPattern.test(intakeId)) {
      return fileIntakeErrorResponse(new FileIntakeRequestError());
    }
    const idempotencyKey = fileIntakeIdempotencyKey(request);
    if (!idempotencyKey) return fileIntakeErrorResponse(new FileIntakeRequestError());
    const body = bodySchema.parse(await parseIntegrationJson(request));
    const requestContext = await createProjectCeoRequestContext();
    const data = await new FileIntakeService(requestContext.client, requestContext.storage).review({
      projectId,
      intakeId,
      decision: body.decision,
      reason: body.reason,
      idempotencyKey,
    });
    return NextResponse.json({ data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return fileIntakeErrorResponse(error);
  }
}
