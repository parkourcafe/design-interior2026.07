import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ProjectLinkService } from "@/lib/integration-gateway/links/project-link-service";
import { parseIntegrationJson } from "@/lib/integration-gateway/registry/http";
import {
  idempotencyKey,
  projectIdPattern,
  projectLinksJsonMaxBytes,
  projectLinksDisabledResponse,
  projectLinksEnabled,
  projectLinksErrorResponse,
  projectLinksRequestErrorResponse,
  assertProjectLinksMutation,
} from "@/lib/integration-gateway/links/http";

export const dynamic = "force-dynamic";

const revisionSchema = z.object({
  url: z.string().trim().min(1).max(4096),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  note: z.string().trim().max(2000).nullable().default(null),
  reason: z.string().trim().max(500).nullable().default(null),
}).strict();

export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly projectId: string; readonly linkId: string }> },
) {
  if (!projectLinksEnabled()) return projectLinksDisabledResponse();
  const { projectId, linkId } = await context.params;
  if (!projectIdPattern.test(projectId) || !projectIdPattern.test(linkId)) {
    return projectLinksDisabledResponse();
  }
  const key = idempotencyKey(request);
  if (!key || !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json(
      { error: { code: "validation_failed", messageKey: "projectLinks.errors.invalidRequest" } },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  try {
    assertProjectLinksMutation(request);
    const body = revisionSchema.parse(
      await parseIntegrationJson(request, projectLinksJsonMaxBytes),
    );
    const service = new ProjectLinkService(await createClient());
    const result = await service.revise({
      projectId,
      linkId,
      ...body,
      idempotencyKey: key,
    });
    return NextResponse.json(
      { data: result },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const requestError = projectLinksRequestErrorResponse(error);
    if (requestError) return requestError;
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json(
        { error: { code: "validation_failed", messageKey: "projectLinks.errors.invalidRequest" } },
        { status: 400, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    return projectLinksErrorResponse(error);
  }
}
