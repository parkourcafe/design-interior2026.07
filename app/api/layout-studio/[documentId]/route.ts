import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { isLayoutStudioEnabled } from "@/lib/layout-studio/feature-flag";
import { SupabaseLayoutRepository } from "@/lib/layout-studio/adapters/supabase/supabase-layout-repository";
import { LayoutRepositoryError } from "@/lib/layout-studio/adapters/local/memory-layout-repository";
import type { LayoutDocument } from "@/lib/layout-studio/domain";

export const dynamic = "force-dynamic";

/**
 * Единственный вход редактора к серверному хранилищу планировок.
 *
 * Доступ не проверяется здесь построчно и это намеренно: клиент создаётся из
 * cookie залогиненного дизайнера, все запросы идут через RLS миграции
 * 20260808050000. Service role не используется — иначе роут стал бы дырой в
 * обход политик. Чужая планировка неотличима от несуществующей: и то и другое
 * даёт 404.
 */

// Документ не разбирается по полям: его структуру проверяет замороженная схема
// внутри хранилища, и дублировать её здесь значило бы завести второй источник
// истины.
const documentSchema = z.object({ documentId: z.string().min(1) }).passthrough();

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("saveDraft"),
    document: documentSchema,
    expectedRevision: z.number().int().nullable(),
  }),
  z.object({
    action: z.literal("createCheckpoint"),
    document: documentSchema,
    checkpointId: z.string().min(1),
    reasonCode: z.string().min(1),
    reason: z.string(),
    createdAt: z.string().min(1),
  }),
  z.object({
    action: z.literal("publishVersion"),
    document: documentSchema,
    versionId: z.string().min(1),
    parentVersionId: z.string().min(1).optional(),
    authorType: z.string().min(1),
    reasonCode: z.string().min(1),
    reason: z.string(),
    createdAt: z.string().min(1),
    warnings: z.array(z.string()),
  }),
  z.object({
    action: z.literal("restoreCheckpoint"),
    checkpointId: z.string().min(1),
    expectedRevision: z.number().int(),
  }),
]);

/** Доменные ошибки → коды HTTP. Всё неизвестное — 500, а не «наверное 400». */
const STATUS_BY_CODE: Record<string, number> = {
  DOCUMENT_NOT_FOUND: 404,
  CHECKPOINT_NOT_FOUND: 404,
  VERSION_NOT_FOUND: 404,
  PARENT_VERSION_NOT_FOUND: 404,
  STATE_STALE: 409,
  VERSION_IMMUTABLE: 409,
  CHECKPOINT_IMMUTABLE: 409,
  DOCUMENT_EXISTS: 409,
  VERSION_SCHEMA_INVALID: 422,
  DOCUMENT_SCHEMA_INVALID: 422,
  PARENT_DOCUMENT_MISMATCH: 422,
};

function failure(error: unknown) {
  if (error instanceof LayoutRepositoryError) {
    return NextResponse.json(
      { error: error.code, message: error.message },
      { status: STATUS_BY_CODE[error.code] ?? 500 },
    );
  }
  return NextResponse.json({ error: "STORAGE_UNAVAILABLE" }, { status: 500 });
}

async function authorized() {
  if (!isLayoutStudioEnabled()) return null;
  const supabase = await createClient();
  // getClaims проверяет подпись токена; getUser() ей уступает (см. proxy.ts).
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;
  return new SupabaseLayoutRepository(supabase);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  const repository = await authorized();
  if (!repository) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { documentId } = await context.params;

  try {
    const draft = await repository.loadDraft(documentId);
    if (!draft) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const [versions, checkpoints] = await Promise.all([
      repository.listVersions(documentId),
      repository.listCheckpoints(documentId),
    ]);
    return NextResponse.json({ draft, versions, checkpoints });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  const repository = await authorized();
  if (!repository) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { documentId } = await context.params;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const body = parsed.data;

  // Планировка адресуется URL-ом. Тело, которое пытается говорить о другом
  // документе, отклоняется, а не выполняется молча по своему documentId.
  if ("document" in body && body.document.documentId !== documentId) {
    return NextResponse.json({ error: "DOCUMENT_MISMATCH" }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "saveDraft": {
        await repository.saveDraft(
          body.document as unknown as LayoutDocument,
          body.expectedRevision,
        );
        return NextResponse.json({ ok: true });
      }
      case "createCheckpoint": {
        const checkpoint = await repository.createCheckpoint(
          body.document as unknown as LayoutDocument,
          {
            checkpointId: body.checkpointId,
            reasonCode: body.reasonCode,
            reason: body.reason,
            createdAt: body.createdAt,
          },
        );
        return NextResponse.json({ checkpoint });
      }
      case "publishVersion": {
        const version = await repository.publishVersion(
          body.document as unknown as LayoutDocument,
          {
            versionId: body.versionId,
            parentVersionId: body.parentVersionId,
            authorType: body.authorType,
            reasonCode: body.reasonCode,
            reason: body.reason,
            createdAt: body.createdAt,
            warnings: body.warnings,
          },
        );
        return NextResponse.json({ version });
      }
      case "restoreCheckpoint": {
        const document = await repository.restoreCheckpoint(
          body.checkpointId,
          body.expectedRevision,
        );
        return NextResponse.json({ document });
      }
    }
  } catch (error) {
    return failure(error);
  }
}
