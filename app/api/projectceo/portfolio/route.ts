import { NextResponse } from "next/server";
import { createProjectCeoServerRequest } from "@/lib/project-intelligence/delivery/projectceo/server-port";
import { PROJECTCEO_SESSION_PROVENANCE_HEADER, ProjectCeoAuthenticationError } from "@/lib/project-intelligence/delivery/projectceo/request-context";
import { projectCeoHttpStatus } from "@/lib/project-intelligence/delivery/projectceo/http-status";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const { port, identity } = await createProjectCeoServerRequest();
    const envelope = await port.getPortfolio({ requestId });
    return NextResponse.json(envelope, {
      status: envelope.error ? projectCeoHttpStatus(envelope.error.code) : 200,
      headers: {
        "Cache-Control": "private, no-store",
        ...(identity?.sessionDigest ? { [PROJECTCEO_SESSION_PROVENANCE_HEADER]: identity.sessionDigest } : {}),
      },
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
