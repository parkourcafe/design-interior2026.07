import { describe, expect, it } from "vitest";

import {
  attachSheetSpecifications,
  registerDocumentationSheet,
  type RegisterDocumentationSheetInput,
} from "@/lib/project-intelligence/modules/documentation";
import { DecisionContractError } from "@/lib/project-intelligence/modules/decisions";

const HANDOFF = {
  contractVersion: "archidom.m2-to-m3-handoff/0.1",
  projectId: "8f6b1f0a-9c4d-4a1e-8b2c-0d5e6f7a8b90",
  packageId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  roomId: "room-kitchen",
  approvedM2CommitId: "commit-1",
  approvedM2CommitRevisionId: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
  designIntentRevisionId: "intent-rev-1",
  layout: {
    documentId: "layout-doc-1",
    versionId: "layout-version-3",
    revisionId: "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f",
    semanticHash: `sha256:${"a".repeat(64)}`,
  },
  selectionRevisionIds: ["sel-rev-1", "sel-rev-2"],
  approvedAt: "2026-08-09T10:00:00Z",
} as const;

const REVISION = {
  revisionId: "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f70",
  revisionNo: 1,
  createdAt: "2026-08-09T11:00:00Z",
  createdBy: { actorId: "architect-1", actorType: "human" as const },
  reason: "Первый лист пакета по утверждённой планировке.",
} as const;

function input(
  overrides: Partial<RegisterDocumentationSheetInput> = {},
): RegisterDocumentationSheetInput {
  return {
    sheetId: "sheet-1",
    sheetNumber: "A-101",
    title: "План кухни",
    roomId: HANDOFF.roomId,
    revision: REVISION,
    handoff: HANDOFF,
    specificationRevisionIds: ["sel-rev-1"],
    ...overrides,
  };
}

describe("Лист документации: регистрация", () => {
  it("несёт происхождение из точного handoff, а не из свободных полей", () => {
    const sheet = registerDocumentationSheet(input());

    // Смысл модуля: по листу видно, из какого утверждённого решения M2 он
    // сделан. Поэтому происхождение копируется из handoff, а вызывающая
    // сторона не может назначить его сама.
    expect(sheet.origin).toEqual({
      handoffContractVersion: HANDOFF.contractVersion,
      approvedM2CommitRevisionId: HANDOFF.approvedM2CommitRevisionId,
      designIntentRevisionId: HANDOFF.designIntentRevisionId,
      layoutDocumentId: HANDOFF.layout.documentId,
      layoutVersionId: HANDOFF.layout.versionId,
      layoutRevisionId: HANDOFF.layout.revisionId,
      semanticHash: HANDOFF.layout.semanticHash,
    });
    expect(sheet.projectId).toBe(HANDOFF.projectId);
    expect(sheet.packageId).toBe(HANDOFF.packageId);
  });

  it("возвращает неизменяемый лист", () => {
    const sheet = registerDocumentationSheet(input());
    expect(Object.isFrozen(sheet)).toBe(true);
    expect(Object.isFrozen(sheet.origin)).toBe(true);
    expect(Object.isFrozen(sheet.specificationRevisionIds)).toBe(true);
  });

  it("отклоняет лист для комнаты, которой нет в handoff", () => {
    // Иначе лист «по утверждённой планировке» описывал бы другое помещение.
    expect(() => registerDocumentationSheet(input({ roomId: "room-bath" })))
      .toThrowError(DecisionContractError);
  });

  it("требует непустые идентификатор, номер и название листа", () => {
    for (const overrides of [
      { sheetId: "  " },
      { sheetNumber: "" },
      { title: "   " },
    ]) {
      expect(() => registerDocumentationSheet(input(overrides)))
        .toThrowError(DecisionContractError);
    }
  });

  it("требует причину ревизии — лист не появляется без объяснения", () => {
    expect(() => registerDocumentationSheet(input({
      revision: { ...REVISION, reason: "   " },
    }))).toThrowError(DecisionContractError);
  });

  it("отклоняет спецификацию, не входящую в утверждённый набор", () => {
    // Пакет документации не может ссылаться на выбор, который клиент не
    // утверждал: это и есть разрыв доказуемости.
    expect(() => registerDocumentationSheet(input({
      specificationRevisionIds: ["sel-rev-unknown"],
    }))).toThrowError(DecisionContractError);
  });

  it("отклоняет дубликаты спецификаций", () => {
    expect(() => registerDocumentationSheet(input({
      specificationRevisionIds: ["sel-rev-1", "sel-rev-1"],
    }))).toThrowError(DecisionContractError);
  });

  it("допускает лист без спецификаций — план комнаты может их не иметь", () => {
    const sheet = registerDocumentationSheet(input({ specificationRevisionIds: [] }));
    expect(sheet.specificationRevisionIds).toEqual([]);
  });

  it("отклоняет подпись планировки не в формате sha256:<hex>", () => {
    expect(() => registerDocumentationSheet(input({
      handoff: { ...HANDOFF, layout: { ...HANDOFF.layout, semanticHash: "a".repeat(64) } },
    }))).toThrowError(DecisionContractError);
  });
});

describe("Лист документации: привязка спецификаций", () => {
  it("новая ревизия листа не меняет прежнюю", () => {
    const sheet = registerDocumentationSheet(input());
    const next = attachSheetSpecifications(sheet, {
      specificationRevisionIds: ["sel-rev-2"],
      approvedSelectionRevisionIds: HANDOFF.selectionRevisionIds,
      revision: { ...REVISION, revisionId: "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a81", revisionNo: 2 },
    });

    // Append-only: прошлая ревизия остаётся ровно такой, какой была выпущена.
    expect(sheet.specificationRevisionIds).toEqual(["sel-rev-1"]);
    expect(next.specificationRevisionIds).toEqual(["sel-rev-1", "sel-rev-2"]);
    expect(next.revision.revisionNo).toBe(2);
    expect(next.origin).toEqual(sheet.origin);
  });

  it("отклоняет ревизию не старше текущей", () => {
    const sheet = registerDocumentationSheet(input());
    expect(() => attachSheetSpecifications(sheet, {
      specificationRevisionIds: ["sel-rev-2"],
      approvedSelectionRevisionIds: HANDOFF.selectionRevisionIds,
      revision: REVISION,
    })).toThrowError(DecisionContractError);
  });

  it("отклоняет повторную привязку уже привязанной спецификации", () => {
    const sheet = registerDocumentationSheet(input());
    expect(() => attachSheetSpecifications(sheet, {
      specificationRevisionIds: ["sel-rev-1"],
      approvedSelectionRevisionIds: HANDOFF.selectionRevisionIds,
      revision: { ...REVISION, revisionId: "6f7a8b9c-0d1e-4f2a-8b3c-4d5e6f7a8b92", revisionNo: 2 },
    })).toThrowError(DecisionContractError);
  });

  // Паритет с регистрацией и с серверным RPC, который перечитывает handoff:
  // привязка — не обходной путь мимо утверждённого набора.
  it("отклоняет привязку выбора вне утверждённого набора", () => {
    const sheet = registerDocumentationSheet(input());
    expect(() => attachSheetSpecifications(sheet, {
      specificationRevisionIds: ["sel-rev-foreign"],
      approvedSelectionRevisionIds: HANDOFF.selectionRevisionIds,
      revision: { ...REVISION, revisionId: "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9ca3", revisionNo: 2 },
    })).toThrowError(DecisionContractError);
  });
});
