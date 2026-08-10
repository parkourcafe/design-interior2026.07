import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { PROJECTCEO_TABS } from "@/components/projectceo/contracts";
import { recordIdFromContent } from "@/components/projectceo/record-id";
import { projectCeoCommandSchema } from "@/lib/project-intelligence/delivery/projectceo/command-contract";
import { visibleTabsForRole } from "@/components/projectceo/role-policy";
import { ru } from "@/lib/i18n/ru";

const workspace = readFileSync(
  resolve(process.cwd(), "components/projectceo/project-workspace.tsx"),
  "utf8",
);

describe("M3 documentation surface", () => {
  it("is a tab of the project workspace, not a separate route tree", () => {
    expect(PROJECTCEO_TABS).toContain("documentation");
    // A5 §4.2.2 применяется к этой топологии так: модуль живёт внутри рабочего
    // пространства проекта, поэтому у него нет собственных маршрутов.
    expect(workspace).toContain('case "documentation": return <DocumentationView');
  });

  it("shows the tab only to the studio side", () => {
    for (const role of ["owner", "architect"] as const) {
      expect(visibleTabsForRole(role)).toContain("documentation");
    }
    // Клиент утверждает варианты M2 и внутренностей пакета не получает;
    // строитель и гость не получают материала M3 вовсе. Это то же правило,
    // которым проекция v7 закрывает листы на сервере.
    for (const role of ["client", "builder", "guest"] as const) {
      expect(visibleTabsForRole(role)).not.toContain("documentation");
    }
  });

  it("hides the tab entirely when the surface does not exist for this human", () => {
    // Пустая вкладка читалась бы как «листов нет», хотя правда может быть
    // «модуль выключен» или «эта роль их не получает».
    expect(workspace).toMatch(
      /item !== "documentation" \|\| view\.documentation !== null/,
    );
  });

  it("renders completeness computed by the module, never recomputed in the UI", () => {
    expect(workspace).toContain("documentation.completeness.map");
    expect(workspace).not.toMatch(/reviewPackageCompleteness/);
    // Ни одного собственного вывода неполноты: коды приходят с сервера.
    expect(workspace).not.toMatch(/ROOM_WITHOUT_SHEET|SPECIFICATION_NOT_COVERED/);
  });

  it("names every completeness finding in the central dictionary", () => {
    const findings = ru.projectCeo.workspace.documentation.findings;
    expect(Object.keys(findings).sort()).toEqual([
      "DUPLICATE_SHEET_NUMBER",
      "ROOM_WITHOUT_SHEET",
      "SHEET_FROM_OTHER_APPROVAL",
      "SPECIFICATION_NOT_COVERED",
    ]);
    for (const value of Object.values(findings)) {
      expect(value.length).toBeGreaterThan(10);
    }
    // Продуктовое правило: модуль называет нехватку, решает человек.
    expect(ru.projectCeo.workspace.documentation.decisionIsHuman).toMatch(/Решение/);
  });
});

describe("M3 source review controls", () => {
  it("binds the review buttons to the server-derived operation state", () => {
    expect(workspace).toContain("view.operations.review_source");
    expect(workspace).toMatch(
      /operation\.status === "available" && target !== null && !decided/,
    );
    // Обе кнопки решения выключаются одним и тем же признаком: разойдутся —
    // одна начнёт обещать то, что сервер отклонит.
    expect(workspace.match(/disabled=\{!available\}/g)).toHaveLength(2);
  });

  it("sends the decision as a real command with the target revision", () => {
    expect(workspace).toMatch(/kind: "review_source" as const/);
    expect(workspace).toMatch(/targetRevisionId: target \?\? ""/);
    expect(workspace).toMatch(/expectedRevisionId: target \?\? ""/);
    expect(workspace).toMatch(/command\("confirmed"\)/);
    expect(workspace).toMatch(/command\("rejected"\)/);
  });

  it("keeps clarification honestly disabled instead of faking a third decision", () => {
    // У сервера словарь решений — confirmed | rejected. Третьей кнопки,
    // которая «как будто работает», быть не должно.
    expect(workspace).toMatch(
      /\{projectCeoRu\.actions\.clarification\}/,
    );
    expect(workspace).toMatch(/<button type="button" disabled className="btn-ghost">/);
    expect(ru.projectCeo.workspace.sources.clarificationNotBuilt).toMatch(/не построено/);
  });

  it("explains every unavailable state in words", () => {
    for (const key of [
      "moduleDisabled",
      "noReviewCapability",
      "noReviewClaimCapability",
      "noReviewTarget",
      "alreadyDecided",
    ] as const) {
      expect(ru.projectCeo.workspace.sources[key].length).toBeGreaterThan(10);
    }
  });
});

describe("M3 source intake form", () => {
  const content = ["AR-01_план.pdf", "package-1", "1", "Гостиная", "AR", "current"];

  it("gives the same declared document one identity, not one per press", () => {
    expect(recordIdFromContent(content)).toBe(recordIdFromContent(content));
    // Пробелы по краям — это опечатка ввода, а не другой документ.
    expect(recordIdFromContent(content.map((part) => ` ${part} `)))
      .toBe(recordIdFromContent(content));
    expect(recordIdFromContent([...content.slice(0, 5), "reference"]))
      .not.toBe(recordIdFromContent(content));
  });

  it("produces an identifier the command contract accepts", () => {
    const parsed = projectCeoCommandSchema.safeParse({
      contractVersion: "projectceo-command/0.1",
      kind: "register_source",
      projectId: "11111111-1111-4111-8111-111111111111",
      commandId: "22222222-2222-4222-8222-222222222222",
      payload: {
        packageId: "33333333-3333-4333-8333-333333333333",
        physicalRecordId: recordIdFromContent(content),
        sanitizedName: "AR-01_plan.pdf",
        floorId: "1",
        zoneId: "living",
        disciplineId: "AR",
        availability: "placeholder",
        documentStatus: "current",
        sizeBytes: null,
        checksum: null,
        sourceRevisionId: null,
        semanticConflict: false,
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("declares a placeholder only — materialisation is not promised by the form", () => {
    // Файл, размер и контрольная сумма приходят путём загрузки; RPC отклонит
    // плейсхолдер, пришедший с ними, поэтому форма их и не собирает.
    expect(workspace).toMatch(/availability: "placeholder" as const/);
    expect(workspace).toMatch(/sizeBytes: null/);
    expect(workspace).toMatch(/checksum: null/);
    expect(workspace).toMatch(/sourceRevisionId: null/);
    expect(ru.projectCeo.workspace.sources.registerHint).toMatch(/отдельным путём загрузки/);
  });

  it("offers the form only when the server says the command is available", () => {
    expect(workspace).toMatch(/const operation = view\.operations\.register_source/);
    expect(workspace).toMatch(/if \(operation\.status !== "available"\)/);
  });
});
