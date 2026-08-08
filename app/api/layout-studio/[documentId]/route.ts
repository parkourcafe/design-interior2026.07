import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { isLayoutStudioEnabled } from "@/lib/layout-studio/feature-flag";
import { SupabaseLayoutRepository } from "@/lib/layout-studio/adapters/supabase/supabase-layout-repository";
import { LayoutRepositoryError } from "@/lib/layout-studio/adapters/local/memory-layout-repository";
import {
  parseWorkspaceBinding,
  ROOM_ID_PATTERN,
  WORKSPACE_VARIANT_ROLES,
} from "@/lib/layout-studio/application/workspace-binding";
import type { LayoutDocument } from "@/lib/layout-studio/domain";

export const dynamic = "force-dynamic";

/**
 * Единственный вход редактора к серверному хранилищу рабочего состояния:
 * черновики и чекпойнты.
 *
 * Публикации версий здесь НЕТ намеренно. Подписанные версии публикуются через
 * command API объединённого контура (/api/projectceo/commands,
 * kind=publish_m2_layout_version): там Postgres перевалидирует документ и сам
 * пересчитывает семантический хеш. Дублирующий путь публикации означал бы два
 * движка версий.
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
    action: z.literal("restoreCheckpoint"),
    checkpointId: z.string().min(1),
    expectedRevision: z.number().int(),
  }),
  z.object({
    action: z.literal("bindWorkspace"),
    projectId: z.string().uuid(),
    packageId: z.string().uuid(),
    roomId: z.string().regex(ROOM_ID_PATTERN),
    role: z.enum(WORKSPACE_VARIANT_ROLES),
  }),
]);

/** Доменные ошибки → коды HTTP. Всё неизвестное — 500, а не «наверное 400». */
const STATUS_BY_CODE: Record<string, number> = {
  DOCUMENT_NOT_FOUND: 404,
  CHECKPOINT_NOT_FOUND: 404,
  STATE_STALE: 409,
  CHECKPOINT_IMMUTABLE: 409,
  DOCUMENT_EXISTS: 409,
  DOCUMENT_SCHEMA_INVALID: 422,
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
    const [checkpoints, binding] = await Promise.all([
      repository.listCheckpoints(documentId),
      repository.loadWorkspaceBinding(documentId),
    ]);
    // versions: подписанные версии живут в хранилище projectceo_product и
    // читаются его собственным роутом; здесь их принципиально нет. binding
    // говорит редактору, куда публиковать (и публиковать ли вообще).
    return NextResponse.json({ draft, versions: [], checkpoints, binding });
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
      case "restoreCheckpoint": {
        const document = await repository.restoreCheckpoint(
          body.checkpointId,
          body.expectedRevision,
        );
        return NextResponse.json({ document });
      }
      case "bindWorkspace": {
        // Повторный разбор той же формы, что и у CHECK-ограничений миграции:
        // zod выше проверил типы, парсер — паттерны uuid/roomId и словарь
        // ролей. Принадлежность пользователя пакету проверяет сервер
        // projectceo при публикации, здесь её проверить нечем и не нужно.
        const binding = parseWorkspaceBinding({
          projectId: body.projectId,
          packageId: body.packageId,
          roomId: body.roomId,
          role: body.role,
        });
        if (!binding) return NextResponse.json({ error: "bad_request" }, { status: 400 });
        await repository.saveWorkspaceBinding(documentId, binding);
        return NextResponse.json({ ok: true, binding });
      }
    }
  } catch (error) {
    return failure(error);
  }
}
