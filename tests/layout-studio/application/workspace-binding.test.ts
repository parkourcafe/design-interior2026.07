import { describe, expect, it } from "vitest";

import {
  ROOM_ID_PATTERN,
  mintRoomId,
  parseWorkspaceBinding,
  prepareForPublication,
} from "@/lib/layout-studio/application/workspace-binding";
import { canonicalSerialize } from "@/lib/layout-studio/domain";

import { makeSimpleRoom } from "./layout-test-fixture";

const PROJECT_UUID = "20000000-0000-4000-8000-000000000002";
const PACKAGE_UUID = "20000000-0000-4000-8000-000000000003";

const binding = {
  projectId: PROJECT_UUID,
  packageId: PACKAGE_UUID,
  roomId: "kuhnya-gostinaya",
  role: "preferred",
} as const;

describe("mintRoomId: детерминированный минт идентификатора комнаты", () => {
  it("транслитерирует русское название в закреплённый алфавит", () => {
    const minted = mintRoomId("Кухня-гостиная", "seed");
    expect(minted).toBe("kuhnya-gostinaya");
    expect(ROOM_ID_PATTERN.test(minted)).toBe(true);
  });

  it("одно название — один результат", () => {
    expect(mintRoomId("Спальня №2", "a")).toBe(mintRoomId("Спальня №2", "b"));
  });

  it("непригодное название даёт честный фолбэк, а не исключение", () => {
    const minted = mintRoomId("🛋️🛋️", "Doc.ID-42");
    expect(minted).toBe("room-docid42");
    expect(ROOM_ID_PATTERN.test(minted)).toBe(true);
  });

  it("не выходит за 160 символов лимита commitM2Identifier", () => {
    const minted = mintRoomId("к".repeat(400), "seed");
    expect(minted.length).toBeLessThanOrEqual(160);
    expect(ROOM_ID_PATTERN.test(minted)).toBe(true);
  });
});

describe("parseWorkspaceBinding: разбор привязки", () => {
  it("принимает полную корректную привязку", () => {
    expect(parseWorkspaceBinding(binding)).toEqual(binding);
  });

  it.each([
    ["не-uuid проекта", { ...binding, projectId: "project.simple" }],
    ["не-uuid пакета", { ...binding, packageId: "42" }],
    ["комната вне алфавита", { ...binding, roomId: "кухня" }],
    ["комната короче 3 символов", { ...binding, roomId: "ab" }],
    ["роль вне словаря", { ...binding, role: "draft" }],
    ["null", null],
    ["пустой объект", {}],
  ])("отклоняет: %s", (_label, value) => {
    expect(parseWorkspaceBinding(value)).toBeNull();
  });
});

describe("prepareForPublication: публикационная копия черновика", () => {
  it("меняет ровно два поля: projectId и variant.status", () => {
    const draft = makeSimpleRoom();
    const publication = prepareForPublication(draft, binding);

    expect(publication.projectId).toBe(PROJECT_UUID);
    expect(publication.variant.status).toBe("published");

    // Всё остальное байт-в-байт совпадает: сравниваем канонические
    // сериализации, вернув двум полям исходные значения.
    const reverted = structuredClone(publication);
    (reverted as { projectId: string }).projectId = draft.projectId;
    (reverted.variant as { status: string }).status = draft.variant.status;
    expect(canonicalSerialize(reverted)).toBe(canonicalSerialize(draft));
  });

  it("не трогает сам черновик", () => {
    const draft = makeSimpleRoom();
    const before = canonicalSerialize(draft);
    prepareForPublication(draft, binding);
    expect(canonicalSerialize(draft)).toBe(before);
    expect(draft.variant.status).not.toBe("published");
  });
});
