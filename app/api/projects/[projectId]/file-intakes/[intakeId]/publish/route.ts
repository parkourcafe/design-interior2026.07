import { NextResponse, type NextRequest } from "next/server";
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

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/projects/[projectId]/file-intakes/[intakeId]/publish">,
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
    const requestContext = await createProjectCeoRequestContext();
    const service = new FileIntakeService(requestContext.client, requestContext.storage);
    const storageAuthorization = await service.storageAuthorization({ projectId, intakeId });
    if (storageAuthorization.status === "ingested_candidate") {
      await service.copyToInternal({ authorization: storageAuthorization });
    }
    const data = await service.publish({ projectId, intakeId, idempotencyKey });
    return NextResponse.json({ data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return fileIntakeErrorResponse(error);
  }
}
