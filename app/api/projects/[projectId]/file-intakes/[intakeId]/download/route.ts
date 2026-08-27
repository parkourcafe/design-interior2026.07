import { NextResponse, type NextRequest } from "next/server";
import { createProjectCeoRequestContext } from "@/lib/project-intelligence/delivery/projectceo/request-context";
import { FileIntakeService } from "@/lib/integration-gateway/file-intake/service";
import {
  fileIntakeDisabledResponse,
  fileIntakeEnabled,
  fileIntakeErrorResponse,
  fileIntakeProjectIdPattern,
  FileIntakeRequestError,
} from "@/lib/integration-gateway/file-intake/http";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: RouteContext<"/api/projects/[projectId]/file-intakes/[intakeId]/download">,
) {
  if (!fileIntakeEnabled()) return fileIntakeDisabledResponse();
  try {
    const { projectId, intakeId } = await context.params;
    if (!fileIntakeProjectIdPattern.test(projectId) || !fileIntakeProjectIdPattern.test(intakeId)) {
      return fileIntakeErrorResponse(new FileIntakeRequestError());
    }
    const requestContext = await createProjectCeoRequestContext();
    const data = await new FileIntakeService(requestContext.client, requestContext.storage).createSignedDownload({
      projectId,
      intakeId,
    });
    return NextResponse.json({ data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return fileIntakeErrorResponse(error);
  }
}
