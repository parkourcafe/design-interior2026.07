import { describe, expect, it } from "vitest";

import {
  registerDocumentationSheet,
  reviewPackageCompleteness,
  type DocumentationSheet,
  type RegisterDocumentationSheetInput,
} from "@/lib/project-intelligence/modules/documentation";

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
  reason: "Лист пакета по утверждённой планировке.",
} as const;

function sheet(
  overrides: Partial<RegisterDocumentationSheetInput> = {},
): DocumentationSheet {
  return registerDocumentationSheet({
    sheetId: "sheet-1",
    sheetNumber: "A-101",
    title: "План кухни",
    roomId: HANDOFF.roomId,
    revision: REVISION,
    handoff: HANDOFF,
    specificationRevisionIds: ["sel-rev-1", "sel-rev-2"],
    ...overrides,
  });
}

describe("Комплектность пакета документации", () => {
  it("пакет комплектен, когда комната покрыта и все утверждённые выборы отражены", () => {
    const report = reviewPackageCompleteness({
      handoff: HANDOFF,
      sheets: [sheet()],
    });

    expect(report.complete).toBe(true);
    expect(report.findings).toEqual([]);
  });

  it("сообщает о комнате без единого листа", () => {
    const report = reviewPackageCompleteness({ handoff: HANDOFF, sheets: [] });

    expect(report.complete).toBe(false);
    expect(report.findings).toContainEqual({
      code: "ROOM_WITHOUT_SHEET",
      subject: HANDOFF.roomId,
    });
  });

  it("сообщает об утверждённом выборе, который не отражён ни на одном листе", () => {
    // Клиент утвердил и оплатил решение, а в выданном пакете его нет — это
    // ровно та дыра, из-за которой на стройке ставят не то.
    const report = reviewPackageCompleteness({
      handoff: HANDOFF,
      sheets: [sheet({ specificationRevisionIds: ["sel-rev-1"] })],
    });

    expect(report.complete).toBe(false);
    expect(report.findings).toContainEqual({
      code: "SPECIFICATION_NOT_COVERED",
      subject: "sel-rev-2",
    });
  });

  it("сообщает о листе из другого утверждения", () => {
    // Пакет, собранный из двух разных утверждений, не доказывает ничего:
    // непонятно, какое решение он выражает.
    const foreign = registerDocumentationSheet({
      sheetId: "sheet-foreign",
      sheetNumber: "A-102",
      title: "План кухни, прошлое утверждение",
      roomId: HANDOFF.roomId,
      revision: REVISION,
      handoff: {
        ...HANDOFF,
        approvedM2CommitRevisionId: "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c03",
      },
      specificationRevisionIds: ["sel-rev-1", "sel-rev-2"],
    });

    const report = reviewPackageCompleteness({
      handoff: HANDOFF,
      sheets: [sheet(), foreign],
    });

    expect(report.complete).toBe(false);
    expect(report.findings).toContainEqual({
      code: "SHEET_FROM_OTHER_APPROVAL",
      subject: "sheet-foreign",
    });
  });

  it("сообщает о двух листах с одним номером", () => {
    const duplicate = sheet({ sheetId: "sheet-2", title: "План кухни, повтор" });

    const report = reviewPackageCompleteness({
      handoff: HANDOFF,
      sheets: [sheet(), duplicate],
    });

    expect(report.complete).toBe(false);
    expect(report.findings).toContainEqual({
      code: "DUPLICATE_SHEET_NUMBER",
      subject: "A-101",
    });
  });

  it("перечисляет находки в устойчивом порядке и без повторов", () => {
    // Отчёт читает человек и сравнивает с прошлым прогоном: порядок обязан
    // быть одинаковым при одинаковом входе, иначе разница нечитаема.
    const first = reviewPackageCompleteness({ handoff: HANDOFF, sheets: [] });
    const second = reviewPackageCompleteness({ handoff: HANDOFF, sheets: [] });

    expect(first.findings).toEqual(second.findings);
    expect(first.findings.map((finding) => `${finding.code}:${finding.subject}`))
      .toEqual([
        "ROOM_WITHOUT_SHEET:room-kitchen",
        "SPECIFICATION_NOT_COVERED:sel-rev-1",
        "SPECIFICATION_NOT_COVERED:sel-rev-2",
      ]);
  });

  it("возвращает неизменяемый отчёт", () => {
    const report = reviewPackageCompleteness({ handoff: HANDOFF, sheets: [] });
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.findings)).toBe(true);
  });
});
