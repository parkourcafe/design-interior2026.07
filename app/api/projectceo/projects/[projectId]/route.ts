import { NextResponse } from "next/server";
import { createProjectCeoServerPort } from "@/lib/project-intelligence/delivery/projectceo/server-port";
import { ProjectCeoAuthenticationError } from "@/lib/project-intelligence/delivery/projectceo/request-context";
import { projectCeoHttpStatus } from "@/lib/project-intelligence/delivery/projectceo/http-status";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ readonly projectId: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    const { projectId } = await context.params;
    const port = await createProjectCeoServerPort();
    const envelope = await port.getProjectWorkspace({ projectId, requestId });
    const status = envelope.error ? projectCeoHttpStatus(envelope.error.code) : 200;
    return NextResponse.json(envelope, {
      status,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const code = error instanceof ProjectCeoAuthenticationError
      ? error.code
      : "internal_error";
    return NextResponse.json({
      contractVersion: "projectceo-ui/0.1",
      requestId,
      data: null,
      error: {
        code,
        messageKey: `project_ceo.error.${code}`,
        retryable: code === "internal_error",
      },
    }, {
      status: projectCeoHttpStatus(code),
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}
