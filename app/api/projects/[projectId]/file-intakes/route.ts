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
  assertFileIntakeRequestSize,
  boundedFileIntakeRequest,
  FileIntakeRequestError,
} from "@/lib/integration-gateway/file-intake/http";
import { validateUpload } from "@/lib/integration-gateway/file-intake/service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: RouteContext<"/api/projects/[projectId]/file-intakes">,
) {
  if (!fileIntakeEnabled()) return fileIntakeDisabledResponse();
  try {
    const { projectId } = await context.params;
    if (!fileIntakeProjectIdPattern.test(projectId)) return fileIntakeErrorResponse(new FileIntakeRequestError());
    const requestContext = await createProjectCeoRequestContext();
    const data = await new FileIntakeService(requestContext.client, requestContext.storage).list(projectId);
    return NextResponse.json({ data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return fileIntakeErrorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/projects/[projectId]/file-intakes">,
) {
  if (!fileIntakeEnabled()) return fileIntakeDisabledResponse();
  try {
    assertFileIntakeMutation(request);
    const { projectId } = await context.params;
    if (!fileIntakeProjectIdPattern.test(projectId)) return fileIntakeErrorResponse(new FileIntakeRequestError());
    const idempotencyKey = fileIntakeIdempotencyKey(request);
    if (!idempotencyKey) return fileIntakeErrorResponse(new FileIntakeRequestError());
    const requestContext = await createProjectCeoRequestContext();
    assertFileIntakeRequestSize(request);
    const form = await boundedFileIntakeRequest(request).formData().catch(() => null);
    if (!form) return fileIntakeErrorResponse(new FileIntakeRequestError());
    const file = form.get("file");
    if (!(file instanceof File)) return fileIntakeErrorResponse(new FileIntakeRequestError());
    const upload = validateUpload({
      bytes: new Uint8Array(await file.arrayBuffer()),
      filename: file.name,
      browserMediaType: file.type || null,
      sourceRole: String(form.get("sourceRole") ?? "document"),
    });
    const result = await new FileIntakeService(requestContext.client, requestContext.storage).createAndUpload({
      projectId,
      upload,
      idempotencyKey,
    });
    return NextResponse.json({ data: result }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return fileIntakeErrorResponse(error);
  }
}
