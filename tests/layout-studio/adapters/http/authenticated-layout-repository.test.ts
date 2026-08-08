import { describe, expect, it, vi } from "vitest";

import {
  AuthenticatedLayoutRepository,
  LayoutRepositoryError,
} from "@/lib/layout-studio/adapters/http/authenticated-layout-repository";
import type {
  LayoutRepository,
  LayoutVersion,
  VersionPublicationInput,
} from "@/lib/layout-studio/application/layout-repository";
import { applyLayoutCommand, semanticHash } from "@/lib/layout-studio/domain";

import {
  makeSimpleRoom,
  moveTableCommand,
} from "../../application/layout-test-fixture";

const projectId = "50000000-0000-4000-8000-000000000001";
const packageId = "50000000-0000-4000-8000-000000000002";
const actorUserId = "50000000-0000-4000-8000-000000000003";
const organizationId = "50000000-0000-4000-8000-000000000004";
const commandId = "50000000-0000-4000-8000-000000000005";
const revisionId = "50000000-0000-4000-8000-000000000006";
const documentId = "living-room-layout";
const versionId = "living-room-layout@3";
const roomId = "living-room";
const variantId = "variant-preferred";

function publishedDocument() {
  const document = makeSimpleRoom();
  document.projectId = projectId;
  document.documentId = documentId;
  document.variant.id = variantId;
  document.variant.status = "published";
  return document;
}

async function layoutRow(overrides: Record<string, unknown> = {}) {
  const content = publishedDocument();
  const hash = `sha256:${await semanticHash(content)}`;
  return {
    id: documentId,
    documentId,
    versionId,
    packageId,
    revisionId,
    revisionNo: 3,
    semanticHash: hash,
    roomId,
    variantId,
    role: "preferred",
    schemaVersion: "project-ceo-m2-layout/0.1",
    status: "published",
    payload: {
      versionId,
      roomId,
      variantId,
      role: "preferred",
      semanticHash: hash,
      schemaVersion: "project-ceo-m2-layout/0.1",
      layoutContent: content,
    },
    createdAt: "2026-08-06T05:00:00.000Z",
    ...overrides,
  };
}

async function contextualLayoutRow(input: {
  documentId: string;
  versionId: string;
  roomId: string;
  variantId: string;
  role: "preferred" | "value_engineered" | "premium";
  revisionId: string;
  revisionNo: number;
}) {
  const content = publishedDocument();
  content.documentId = input.documentId;
  content.variant.id = input.variantId;
  const hash = `sha256:${await semanticHash(content)}`;
  return {
    id: input.documentId,
    documentId: input.documentId,
    versionId: input.versionId,
    packageId,
    revisionId: input.revisionId,
    revisionNo: input.revisionNo,
    semanticHash: hash,
    roomId: input.roomId,
    variantId: input.variantId,
    role: input.role,
    schemaVersion: "project-ceo-m2-layout/0.1",
    status: "published",
    payload: {
      versionId: input.versionId,
      roomId: input.roomId,
      variantId: input.variantId,
      role: input.role,
      semanticHash: hash,
      schemaVersion: "project-ceo-m2-layout/0.1",
      layoutContent: content,
    },
    createdAt: `2026-08-06T05:00:0${input.revisionNo}.000Z`,
  };
}

async function readV5(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: "project-ceo-authenticated-read/0.1",
    requestId: "http:m2-layout-read",
    data: { m2LayoutVersions: [await layoutRow()] },
    error: null,
    scope: {
      accessScope: "package",
      actorUserId,
      organizationId,
      packageId,
      projectId,
    },
    stateRevision: 52,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function repository(fetchImpl: typeof fetch, ids = [commandId, revisionId]): LayoutRepository {
  let index = 0;
  return new AuthenticatedLayoutRepository({
    fetch: fetchImpl,
    randomUUID: () => ids[index++]!,
    context: {
      projectId,
      packageId,
      roomId,
      variantId,
      role: "preferred",
    },
  });
}

describe("LS-060: AuthenticatedLayoutRepository", () => {
  it("implements the application repository port instead of a memory-adapter contract", () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const port: LayoutRepository = repository(fetchImpl);
    const publication: VersionPublicationInput = {
      versionId,
      reasonCode: "OWNER_CHECKPOINT",
      reason: "Публикация варианта для согласования",
    };

    expect(port.publishVersion).toBeTypeOf("function");
    expect(publication).not.toHaveProperty("createdAt");
    expect(publication).not.toHaveProperty("authorType");
  });

  it("publishes a canonical immutable version through the same-origin command route", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    let readCount = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      requests.push({ url: String(input), init });
      if (String(input).includes("/layouts?")) {
        readCount += 1;
        return jsonResponse(await readV5({
          data: { m2LayoutVersions: readCount === 1 ? [] : [await layoutRow()] },
        }));
      }
      return jsonResponse({
        contractVersion: "projectceo-command/0.1",
        requestId: "http:m2-layout-publish",
        status: "completed",
        operation: "append_m2_layout_version_revision",
        replay: false,
        stateRevision: 53,
        result: {
          entityKind: "layout_version",
          entityId: documentId,
          revisionId,
          revisionNo: 3,
          packageId,
          status: "published",
        },
      });
    });
    const document = publishedDocument();

    const version = await repository(fetchImpl).publishVersion(document, {
      versionId,
      reasonCode: "OWNER_CHECKPOINT",
      reason: "Публикация варианта для согласования",
    });

    expect(requests).toHaveLength(3);
    expect(requests[1]?.url).toBe("/api/projectceo/commands");
    expect(requests[1]?.init).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
    });
    const body = JSON.parse(String(requests[1]?.init?.body));
    expect(body).toStrictEqual({
      contractVersion: "projectceo-command/0.1",
      commandId,
      projectId,
      kind: "publish_m2_layout_version",
      payload: {
        packageId,
        documentId,
        versionId,
        revisionId,
        expectedRevisionId: null,
        roomId,
        variantId,
        role: "preferred",
        semanticHash: `sha256:${await semanticHash(document)}`,
        schemaVersion: "project-ceo-m2-layout/0.1",
        layoutContent: document,
        reason: "Публикация варианта для согласования",
      },
    });
    expect(body).not.toHaveProperty("actorId");
    expect(body).not.toHaveProperty("organizationId");
    expect(body).not.toHaveProperty("stateRevision");
    expect(body).not.toHaveProperty("expectedStateRevision");
    expect(body.payload).not.toHaveProperty("createdAt");
    expect(body.payload).not.toHaveProperty("authorType");
    expect(version).toStrictEqual({
      versionId,
      documentId,
      revisionId,
      revisionNo: 3,
      createdAt: "2026-08-06T05:00:00.000Z",
      semanticHash: body.payload.semanticHash,
      content: document,
    });
  });

  it("chains a second publication to the authoritative latest server revision", async () => {
    const currentRevisionId = "50000000-0000-4000-8000-000000000007";
    const nextCommandId = "50000000-0000-4000-8000-000000000008";
    const nextRevisionId = "50000000-0000-4000-8000-000000000009";
    const current = await layoutRow({ revisionId: currentRevisionId, revisionNo: 3 });
    const next = await layoutRow({
      revisionId: nextRevisionId,
      revisionNo: 4,
      versionId: "living-room-layout@4",
      payload: { ...(await layoutRow()).payload, versionId: "living-room-layout@4" },
      createdAt: "2026-08-06T06:00:00.000Z",
    });
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    let reads = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      requests.push({ url: String(input), init });
      if (String(input).includes("/layouts?")) {
        reads += 1;
        return jsonResponse(await readV5({
          data: { m2LayoutVersions: [reads === 1 ? current : next] },
          stateRevision: reads === 1 ? 52 : 53,
        }));
      }
      return jsonResponse({
        contractVersion: "projectceo-command/0.1",
        requestId: "http:m2-layout-publish-2",
        status: "completed",
        operation: "append_m2_layout_version_revision",
        replay: false,
        stateRevision: 53,
        result: {
          entityKind: "layout_version",
          entityId: documentId,
          revisionId: nextRevisionId,
          revisionNo: 4,
          packageId,
          status: "published",
        },
      });
    });

    const result = await repository(fetchImpl, [nextCommandId, nextRevisionId]).publishVersion(
      publishedDocument(),
      {
        versionId: "living-room-layout@4",
        parentVersionId: versionId,
        reasonCode: "OWNER_CHECKPOINT",
        reason: "Уточнённая версия после проверки",
      },
    );

    expect(requests.map((request) => request.url)).toEqual([
      `/api/projectceo/projects/${encodeURIComponent(projectId)}/layouts?packageId=${encodeURIComponent(packageId)}`,
      "/api/projectceo/commands",
      `/api/projectceo/projects/${encodeURIComponent(projectId)}/layouts?packageId=${encodeURIComponent(packageId)}`,
    ]);
    const command = JSON.parse(String(requests[1]?.init?.body));
    expect(command.payload.expectedRevisionId).toBe(currentRevisionId);
    expect(command).not.toHaveProperty("stateRevision");
    expect(command).not.toHaveProperty("expectedStateRevision");
    expect(result).toStrictEqual({
      versionId: "living-room-layout@4",
      documentId,
      revisionId: nextRevisionId,
      revisionNo: 4,
      createdAt: "2026-08-06T06:00:00.000Z",
      semanticHash: next.payload.semanticHash,
      content: next.payload.layoutContent,
    } satisfies LayoutVersion);
  });

  it("requires parentVersionId for every non-first publication and rejects before POST", async () => {
    const currentRevisionId = "52000000-0000-4000-8000-000000000001";
    const nextRevisionId = "52000000-0000-4000-8000-000000000002";
    const current = await contextualLayoutRow({
      documentId,
      versionId,
      roomId,
      variantId,
      role: "preferred",
      revisionId: currentRevisionId,
      revisionNo: 3,
    });
    const next = await contextualLayoutRow({
      documentId,
      versionId: "living-room-layout@4",
      roomId,
      variantId,
      role: "preferred",
      revisionId: nextRevisionId,
      revisionNo: 4,
    });
    const requests: string[] = [];
    let reads = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      requests.push(String(input));
      if (String(input).includes("/layouts?")) {
        reads += 1;
        return jsonResponse(await readV5({
          data: { m2LayoutVersions: [reads === 1 ? current : next] },
          stateRevision: reads === 1 ? 52 : 53,
        }));
      }
      return jsonResponse({
        contractVersion: "projectceo-command/0.1",
        requestId: "http:m2-layout-missing-parent",
        status: "completed",
        operation: "append_m2_layout_version_revision",
        replay: false,
        stateRevision: 53,
        result: {
          entityKind: "layout_version",
          entityId: documentId,
          revisionId: nextRevisionId,
          revisionNo: 4,
          packageId,
          status: "published",
        },
      });
    });

    await expect(repository(fetchImpl, [commandId, nextRevisionId]).publishVersion(
      publishedDocument(),
      {
        versionId: "living-room-layout@4",
        reasonCode: "OWNER_CHECKPOINT",
        reason: "Новая версия без обязательной ссылки на родителя",
      },
    )).rejects.toMatchObject({ code: "STALE_STATE" });
    expect(requests).toEqual([
      `/api/projectceo/projects/${encodeURIComponent(projectId)}/layouts?packageId=${encodeURIComponent(packageId)}`,
    ]);
  });

  it("loads and lists only exact package-scoped v5 layout versions", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(await readV5()));
    const adapter = repository(fetchImpl);
    const expectedDocument = publishedDocument();
    const expectedHash = `sha256:${await semanticHash(expectedDocument)}`;

    await expect(adapter.loadVersion(versionId)).resolves.toMatchObject({
      versionId,
      documentId,
      semanticHash: expectedHash,
      content: expectedDocument,
    });
    await expect(adapter.listVersions(documentId)).resolves.toEqual([
      expect.objectContaining({ versionId, documentId }),
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      `/api/projectceo/projects/${encodeURIComponent(projectId)}/layouts?packageId=${encodeURIComponent(packageId)}`,
      { method: "GET", credentials: "same-origin", cache: "no-store" },
    );
  });

  it("validates a mixed three-variant history before filtering to its repository context", async () => {
    const preferredV2 = await contextualLayoutRow({
      documentId,
      versionId: "living-room-layout@2",
      roomId,
      variantId,
      role: "preferred",
      revisionId: "51000000-0000-4000-8000-000000000002",
      revisionNo: 2,
    });
    const preferredV3 = await contextualLayoutRow({
      documentId,
      versionId,
      roomId,
      variantId,
      role: "preferred",
      revisionId: "51000000-0000-4000-8000-000000000003",
      revisionNo: 3,
    });
    const valueEngineered = await contextualLayoutRow({
      documentId: "living-room-layout-value",
      versionId: "living-room-layout-value@1",
      roomId,
      variantId: "variant-value-engineered",
      role: "value_engineered",
      revisionId: "51000000-0000-4000-8000-000000000004",
      revisionNo: 1,
    });
    const premium = await contextualLayoutRow({
      documentId: "living-room-layout-premium",
      versionId: "living-room-layout-premium@1",
      roomId,
      variantId: "variant-premium",
      role: "premium",
      revisionId: "51000000-0000-4000-8000-000000000005",
      revisionNo: 1,
    });
    const otherRoom = await contextualLayoutRow({
      documentId: "kitchen-layout",
      versionId: "kitchen-layout@1",
      roomId: "kitchen",
      variantId: "variant-kitchen-preferred",
      role: "preferred",
      revisionId: "51000000-0000-4000-8000-000000000006",
      revisionNo: 1,
    });
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(await readV5({
      data: {
        m2LayoutVersions: [premium, preferredV3, otherRoom, valueEngineered, preferredV2],
      },
    })));
    const adapter = repository(fetchImpl);

    await expect(adapter.listVersions(documentId)).resolves.toEqual([
      expect.objectContaining({ versionId: "living-room-layout@2", revisionNo: 2 }),
      expect.objectContaining({ versionId, revisionNo: 3 }),
    ]);
    await expect(adapter.loadVersion("living-room-layout-premium@1")).resolves.toBeNull();
  });

  it("computes version diffs with the real LayoutDocument domain diff", async () => {
    const before = publishedDocument();
    const moved = applyLayoutCommand(before, moveTableCommand(before));
    expect(moved.ok).toBe(true);
    moved.document.variant.status = "published";
    const from = await layoutRow({
      revisionId: "50000000-0000-4000-8000-000000000007",
      revisionNo: 1,
      versionId: "living-room-layout@1",
      semanticHash: `sha256:${await semanticHash(before)}`,
      payload: {
        ...(await layoutRow()).payload,
        versionId: "living-room-layout@1",
        semanticHash: `sha256:${await semanticHash(before)}`,
        layoutContent: before,
      },
    });
    const to = await layoutRow({
      semanticHash: `sha256:${await semanticHash(moved.document)}`,
      payload: {
        ...(await layoutRow()).payload,
        semanticHash: `sha256:${await semanticHash(moved.document)}`,
        layoutContent: moved.document,
      },
    });
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(await readV5({
      data: { m2LayoutVersions: [from, to] },
    })));

    await expect(repository(fetchImpl).diffVersions("living-room-layout@1", versionId))
      .resolves.toEqual({
        fromVersionId: "living-room-layout@1",
        toVersionId: versionId,
        addedEntityIds: [],
        removedEntityIds: [],
        changed: [{
          entityId: "object.simple-room.table",
          entityType: "object",
          fields: [{ path: "xMm", before: 1000, after: 1100 }],
        }],
      });
  });

  it.each([
    [401, "UNAUTHENTICATED"],
    [403, "FORBIDDEN"],
    [409, "STALE_STATE"],
  ] as const)("fails closed for HTTP %s as %s", async (status, code) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status }));

    await expect(repository(fetchImpl).publishVersion(publishedDocument(), {
      versionId,
      reasonCode: "OWNER_CHECKPOINT",
      reason: "Публикация варианта для согласования",
    })).rejects.toMatchObject({ name: "LayoutRepositoryError", code });
  });

  it.each([
    ["wrong project scope", async () => readV5({ scope: { ...(await readV5()).scope, projectId: packageId } })],
    ["unknown outer envelope field", async () => readV5({ actorUserId })],
    ["unknown narrow data field", async () => readV5({
      data: { m2LayoutVersions: [await layoutRow()], m2ApprovedCommits: [] },
    })],
    ["redacted content", async () => {
      const row = await layoutRow();
      const { layoutContent: _redacted, ...payload } = row.payload;
      return readV5({ data: { m2LayoutVersions: [{ ...row, payload }] } });
    }],
    ["hash mismatch", async () => {
      const row = await layoutRow();
      return readV5({ data: { m2LayoutVersions: [{
        ...row,
        payload: { ...row.payload, semanticHash: `sha256:${"f".repeat(64)}` },
      }] } });
    }],
    ["unknown row data", async () => {
      const row = await layoutRow();
      return readV5({ data: { m2LayoutVersions: [{ ...row, actorUserId }] } });
    }],
  ])("rejects malformed or inapplicable v5 data: %s", async (_name, makeBody) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(await makeBody()));

    await expect(repository(fetchImpl).listVersions(documentId)).rejects.toBeInstanceOf(
      LayoutRepositoryError,
    );
  });

  it("rejects duplicate immutable revision and version identities", async () => {
    const row = await layoutRow();
    const duplicate = structuredClone(row);
    duplicate.createdAt = "2026-08-06T05:00:01.000Z";
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(await readV5({
      data: { m2LayoutVersions: [row, duplicate] },
    })));

    await expect(repository(fetchImpl).listVersions(documentId)).rejects.toMatchObject({
      code: "MALFORMED_RESPONSE",
    });
  });

  it.each([
    ["documentId", (row: Awaited<ReturnType<typeof layoutRow>>) => {
      row.documentId = "different-document";
    }],
    ["versionId", (row: Awaited<ReturnType<typeof layoutRow>>) => {
      row.versionId = "living-room-layout@999";
    }],
    ["semanticHash", (row: Awaited<ReturnType<typeof layoutRow>>) => {
      row.semanticHash = `sha256:${"e".repeat(64)}`;
    }],
    ["roomId", (row: Awaited<ReturnType<typeof layoutRow>>) => {
      row.roomId = "different-room";
    }],
    ["variantId", (row: Awaited<ReturnType<typeof layoutRow>>) => {
      row.variantId = "different-variant";
    }],
    ["role", (row: Awaited<ReturnType<typeof layoutRow>>) => {
      row.role = "premium";
    }],
    ["schemaVersion", (row: Awaited<ReturnType<typeof layoutRow>>) => {
      row.schemaVersion = "project-ceo-m2-layout/9.9";
    }],
  ])("rejects a top-level %s that disagrees with the immutable payload", async (_field, mutate) => {
    const row = await layoutRow();
    mutate(row);
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(await readV5({
      data: { m2LayoutVersions: [row] },
    })));

    await expect(repository(fetchImpl).listVersions(documentId)).rejects.toMatchObject({
      code: "MALFORMED_RESPONSE",
    });
  });

  it("rejects a malformed unrelated variant before applying context filtering", async () => {
    const preferred = await layoutRow();
    const unrelated = await contextualLayoutRow({
      documentId: "living-room-layout-premium",
      versionId: "living-room-layout-premium@1",
      roomId,
      variantId: "variant-premium",
      role: "premium",
      revisionId: "51000000-0000-4000-8000-000000000009",
      revisionNo: 1,
    });
    unrelated.payload.semanticHash = `sha256:${"d".repeat(64)}`;
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(await readV5({
      data: { m2LayoutVersions: [preferred, unrelated] },
    })));

    await expect(repository(fetchImpl).listVersions(documentId)).rejects.toMatchObject({
      code: "MALFORMED_RESPONSE",
    });
  });

  it("rejects trust-bearing extras in a successful command envelope", async () => {
    let requestNo = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      requestNo += 1;
      if (String(input).includes("/layouts?")) {
        return jsonResponse(await readV5({ data: { m2LayoutVersions: [] } }));
      }
      return jsonResponse({
        contractVersion: "projectceo-command/0.1",
        requestId: "http:m2-layout-publish",
        status: "completed",
        operation: "append_m2_layout_version_revision",
        replay: false,
        stateRevision: 53,
        result: {
          entityKind: "layout_version",
          entityId: documentId,
          revisionId,
          revisionNo: 1,
          packageId,
          status: "published",
        },
        actorUserId,
      });
    });

    await expect(repository(fetchImpl).publishVersion(publishedDocument(), {
      versionId,
      reasonCode: "OWNER_CHECKPOINT",
      reason: "Публикация варианта для согласования",
    })).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
    expect(requestNo).toBe(2);
  });

  it("rejects a generic workspace-revision operation for a layout publication", async () => {
    let requestNo = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      requestNo += 1;
      if (String(input).includes("/layouts?")) {
        return jsonResponse(await readV5({ data: { m2LayoutVersions: [] } }));
      }
      return jsonResponse({
        contractVersion: "projectceo-command/0.1",
        requestId: "http:m2-layout-generic-operation",
        status: "completed",
        operation: "append_m2_workspace_revision",
        replay: false,
        stateRevision: 53,
        result: {
          entityKind: "layout_version",
          entityId: documentId,
          revisionId,
          revisionNo: 1,
          packageId,
          status: "published",
        },
      });
    });

    await expect(repository(fetchImpl).publishVersion(publishedDocument(), {
      versionId,
      reasonCode: "OWNER_CHECKPOINT",
      reason: "Публикация варианта для согласования",
    })).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
    expect(requestNo).toBe(2);
  });

  it("resolves the exact returned revision after a concurrent newer publication", async () => {
    const exactRevisionId = "50000000-0000-4000-8000-000000000010";
    const newerRevisionId = "50000000-0000-4000-8000-000000000011";
    const exact = await layoutRow({
      revisionId: exactRevisionId,
      revisionNo: 4,
      versionId: "living-room-layout@4",
      payload: { ...(await layoutRow()).payload, versionId: "living-room-layout@4" },
      createdAt: "2026-08-06T06:00:00.000Z",
    });
    const newer = await layoutRow({
      revisionId: newerRevisionId,
      revisionNo: 5,
      versionId: "living-room-layout@5",
      payload: { ...(await layoutRow()).payload, versionId: "living-room-layout@5" },
      createdAt: "2026-08-06T06:00:01.000Z",
    });
    let reads = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      if (String(input).includes("/layouts?")) {
        reads += 1;
        return jsonResponse(await readV5({
          data: { m2LayoutVersions: reads === 1 ? [] : [newer, exact] },
          stateRevision: reads === 1 ? 52 : 54,
        }));
      }
      return jsonResponse({
        contractVersion: "projectceo-command/0.1",
        requestId: "http:m2-layout-race",
        status: "completed",
        operation: "append_m2_layout_version_revision",
        replay: false,
        stateRevision: 53,
        result: {
          entityKind: "layout_version",
          entityId: documentId,
          revisionId: exactRevisionId,
          revisionNo: 4,
          packageId,
          status: "published",
        },
      });
    });

    const result = await repository(fetchImpl, [commandId, exactRevisionId]).publishVersion(
      publishedDocument(),
      {
        versionId: "living-room-layout@4",
        reasonCode: "OWNER_CHECKPOINT",
        reason: "Публикация перед параллельным обновлением",
      },
    );

    expect(result).toStrictEqual({
      versionId: "living-room-layout@4",
      documentId,
      revisionId: exactRevisionId,
      revisionNo: 4,
      createdAt: "2026-08-06T06:00:00.000Z",
      semanticHash: exact.payload.semanticHash,
      content: exact.payload.layoutContent,
    } satisfies LayoutVersion);
  });

  it.each([
    ["projectId", "project-not-uuid"],
    ["packageId", "package-not-uuid"],
  ] as const)("rejects an invalid runtime %s before any network access", async (field, value) => {
    const fetchImpl = vi.fn<typeof fetch>();

    expect(() => new AuthenticatedLayoutRepository({
      fetch: fetchImpl,
      randomUUID: () => commandId,
      context: {
        projectId,
        packageId,
        roomId,
        variantId,
        role: "preferred",
        [field]: value,
      },
    })).toThrowError(expect.objectContaining({ code: "INVALID_CONTEXT" }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never touches browser storage", async () => {
    const localStorage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    const sessionStorage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal("localStorage", localStorage);
    vi.stubGlobal("sessionStorage", sessionStorage);
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(await readV5()));

    await repository(fetchImpl).listVersions(documentId);

    expect(localStorage.getItem).not.toHaveBeenCalled();
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(sessionStorage.getItem).not.toHaveBeenCalled();
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
