import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ProjectLinkService } from "@/lib/integration-gateway/links/project-link-service";
import { projectLinkCategorySchema } from "@/lib/integration-gateway/core/url-policy";
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

const createProjectLinkSchema = z.object({
  category: projectLinkCategorySchema,
  title: z.string().trim().min(1).max(200),
  url: z.string().trim().min(1).max(4096),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  note: z.string().trim().max(2000).nullable().default(null),
}).strict();

function validProjectId(projectId: string): boolean {
  return projectIdPattern.test(projectId);
}

export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ readonly projectId: string }> },
) {
  if (!projectLinksEnabled()) return projectLinksDisabledResponse();
  const { projectId } = await context.params;
  if (!validProjectId(projectId)) return projectLinksDisabledResponse();
  try {
    const service = new ProjectLinkService(await createClient());
    return NextResponse.json(
      { data: await service.list(projectId) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return projectLinksErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly projectId: string }> },
) {
  if (!projectLinksEnabled()) return projectLinksDisabledResponse();
  const { projectId } = await context.params;
  if (!validProjectId(projectId)) return projectLinksDisabledResponse();
  const key = idempotencyKey(request);
  if (!key || !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json(
      { error: { code: "validation_failed", messageKey: "projectLinks.errors.invalidRequest" } },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  try {
    assertProjectLinksMutation(request);
    const body = createProjectLinkSchema.parse(
      await parseIntegrationJson(request, projectLinksJsonMaxBytes),
    );
    const service = new ProjectLinkService(await createClient());
    const result = await service.create({
      projectId,
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
