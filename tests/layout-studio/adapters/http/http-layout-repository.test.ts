import { describe, expect, it } from "vitest";

import { HttpLayoutRepository } from "@/lib/layout-studio/adapters/http/http-layout-repository";
import { projectCeoCommandSchema } from "@/lib/project-intelligence/delivery/projectceo/command-contract";
import { canonicalSerialize, semanticHash, type LayoutDocument } from "@/lib/layout-studio/domain";

import { makeSimpleRoom } from "../../application/layout-test-fixture";

/**
 * Контур публикации целиком, на моке сети.
 *
 * Смысл теста — замок между двумя мирами: тело POST /api/projectceo/commands,
 * которое собирает наш фасад, разбирается НАСТОЯЩЕЙ zod-схемой команды
 * publish_m2_layout_version (projectCeoCommandSchema — .strict(), superRefine
 * с пересчётом семантического хеша). Если любой из контрактов сдвинется —
 * поле, алфавит, форма хеша — тест падает здесь, а не у дизайнера на кнопке.
 */

const PROJECT_UUID = "20000000-0000-4000-8000-000000000002";
const PACKAGE_UUID = "20000000-0000-4000-8000-000000000003";
const ACTOR_UUID = "20000000-0000-4000-8000-000000000007";
const ORG_UUID = "20000000-0000-4000-8000-000000000008";

const BINDING = {
  projectId: PROJECT_UUID,
  packageId: PACKAGE_UUID,
  roomId: "kuhnya-gostinaya",
  role: "preferred",
} as const;

const READ_CONTRACT = "project-ceo-authenticated-read/0.1";
const COMMAND_CONTRACT = "projectceo-command/0.1";
const LAYOUT_SCHEMA = "project-ceo-m2-layout/0.1";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function readEnvelope(rows: unknown[]): unknown {
  return {
    contractVersion: READ_CONTRACT,
    requestId: "read-1",
    data: { m2LayoutVersions: rows },
    error: null,
    scope: {
      accessScope: "package",
      actorUserId: ACTOR_UUID,
      organizationId: ORG_UUID,
      packageId: PACKAGE_UUID,
      projectId: PROJECT_UUID,
    },
    stateRevision: 0,
  };
}

/** Детерминированные uuid для commandId/revisionId клиента публикации. */
function uuidSequence(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `30000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
  };
}

interface PublishedWorld {
  rows: unknown[];
  commandBodies: unknown[];
}

/**
 * Мок сервера обоих миров: роут черновиков студии и роуты контура projectceo.
 * Публикация ведёт себя как настоящий сервер: валидирует команду их схемой,
 * кладёт строку в проекцию, отвечает их конвертом.
 */
function makeFetch(draft: LayoutDocument, binding: unknown, world: PublishedWorld): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url.startsWith("/api/layout-studio/")) {
      if (!init?.method || init.method === "GET") {
        return json({ draft, versions: [], checkpoints: [], binding });
      }
      return json({ ok: true });
    }

    if (url.startsWith(`/api/projectceo/projects/${PROJECT_UUID}/layouts`)) {
      return json(readEnvelope(world.rows));
    }

    if (url === "/api/projectceo/commands") {
      const body = JSON.parse(String(init?.body)) as {
        payload: {
          revisionId: string;
          versionId: string;
          roomId: string;
          variantId: string;
          role: string;
          semanticHash: string;
          layoutContent: LayoutDocument;
        };
      };
      world.commandBodies.push(body);

      // Настоящая проверка настоящей схемой — сердце теста.
      const parsed = projectCeoCommandSchema.safeParse(body);
      if (!parsed.success) {
        return new Response(JSON.stringify({ error: parsed.error.issues }), { status: 422 });
      }

      const content = body.payload.layoutContent;
      world.rows.push({
        id: content.documentId,
        documentId: content.documentId,
        versionId: body.payload.versionId,
        packageId: PACKAGE_UUID,
        revisionId: body.payload.revisionId,
        revisionNo: world.rows.length + 1,
        semanticHash: body.payload.semanticHash,
        roomId: body.payload.roomId,
        variantId: body.payload.variantId,
        role: body.payload.role,
        schemaVersion: LAYOUT_SCHEMA,
        status: "published",
        payload: {
          versionId: body.payload.versionId,
          roomId: body.payload.roomId,
          variantId: body.payload.variantId,
          role: body.payload.role,
          semanticHash: body.payload.semanticHash,
          schemaVersion: LAYOUT_SCHEMA,
          layoutContent: content,
        },
        createdAt: `2026-08-08T12:0${world.rows.length}:00.000Z`,
      });

      return json({
        contractVersion: COMMAND_CONTRACT,
        requestId: "cmd-1",
        status: "completed",
        operation: "append_m2_layout_version_revision",
        replay: false,
        stateRevision: world.rows.length,
        result: {
          entityKind: "layout_version",
          entityId: content.documentId,
          revisionId: body.payload.revisionId,
          revisionNo: world.rows.length,
          packageId: PACKAGE_UUID,
          status: "published",
        },
      });
    }

    throw new Error(`Неожиданный запрос в тесте: ${url}`);
  };
}

describe("HttpLayoutRepository: контур публикации", () => {
  it("без привязки публикация честно закрыта, а список версий пуст", async () => {
    const draft = makeSimpleRoom();
    const world: PublishedWorld = { rows: [], commandBodies: [] };
    const repository = new HttpLayoutRepository(
      draft.documentId,
      makeFetch(draft, null, world),
      uuidSequence(),
    );

    await expect(repository.listVersions(draft.documentId)).resolves.toEqual([]);
    await expect(
      repository.publishVersion(draft, {
        versionId: "V1",
        reasonCode: "LOCAL_VERSION",
        reason: "Изменения в редакторе планировок",
      }),
    ).rejects.toMatchObject({ code: "VERSION_STORE_NOT_CONNECTED" });
    expect(world.commandBodies).toHaveLength(0);
  });

  it("с привязкой публикует через команду контура, и тело проходит их схему", async () => {
    const draft = makeSimpleRoom();
    const draftBefore = canonicalSerialize(draft);
    const world: PublishedWorld = { rows: [], commandBodies: [] };
    const repository = new HttpLayoutRepository(
      draft.documentId,
      makeFetch(draft, BINDING, world),
      uuidSequence(),
    );

    const version = await repository.publishVersion(draft, {
      versionId: "V1",
      reasonCode: "LOCAL_VERSION",
      reason: "Изменения в редакторе планировок",
    });

    // Команда ушла ровно одна и разобрана их схемой (иначе мок ответил бы 422).
    expect(world.commandBodies).toHaveLength(1);
    const body = world.commandBodies[0] as {
      projectId: string;
      payload: {
        roomId: string;
        variantId: string;
        role: string;
        semanticHash: string;
        layoutContent: LayoutDocument;
      };
    };
    expect(body.projectId).toBe(PROJECT_UUID);
    expect(body.payload.roomId).toBe(BINDING.roomId);
    expect(body.payload.role).toBe(BINDING.role);
    expect(body.payload.variantId).toBe(draft.variant.id);
    // Публикационная копия несёт projectceo-проект и статус published…
    expect(body.payload.layoutContent.projectId).toBe(PROJECT_UUID);
    expect(body.payload.layoutContent.variant.status).toBe("published");
    // …а подпись посчитана уже по ней.
    await expect(semanticHash(body.payload.layoutContent)).resolves.toBe(
      body.payload.semanticHash.replace(/^sha256:/, ""),
    );

    // Черновик не мутирован: публикация — копия, а не перекраска оригинала.
    expect(canonicalSerialize(draft)).toBe(draftBefore);

    // Возвращённая версия — из авторитетного чтения, с префиксованной подписью.
    expect(version.versionId).toBe("V1");
    expect(version.revisionNo).toBe(1);
    expect(version.semanticHash).toMatch(/^sha256:[0-9a-f]{64}$/);

    // Версия видна в списке; вторая публикация продолжает цепочку.
    await expect(repository.listVersions(draft.documentId)).resolves.toHaveLength(1);
    const second = await repository.publishVersion(draft, {
      versionId: "V2",
      parentVersionId: "V1",
      reasonCode: "LOCAL_VERSION",
      reason: "Изменения в редакторе планировок",
    });
    expect(second.revisionNo).toBe(2);
  });

  it("публикация без родителя при живой цепочке отклоняется как STALE_STATE", async () => {
    const draft = makeSimpleRoom();
    const world: PublishedWorld = { rows: [], commandBodies: [] };
    const repository = new HttpLayoutRepository(
      draft.documentId,
      makeFetch(draft, BINDING, world),
      uuidSequence(),
    );

    await repository.publishVersion(draft, {
      versionId: "V1",
      reasonCode: "LOCAL_VERSION",
      reason: "Изменения в редакторе планировок",
    });

    // Код сверяется по форме, а не instanceof: ошибку бросает клиент контура
    // публикации, а у него собственный класс LayoutRepositoryError.
    await expect(
      repository.publishVersion(draft, {
        versionId: "V2",
        reasonCode: "LOCAL_VERSION",
        reason: "Изменения в редакторе планировок",
      }),
    ).rejects.toMatchObject({ name: "LayoutRepositoryError", code: "STALE_STATE" });
  });
});
