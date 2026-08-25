import { describe, expect, it } from "vitest";

import {
  projectCeoCommandSchema,
} from "../../lib/project-intelligence/delivery/projectceo/command-contract";
import {
  findRegistryGhosts,
  findUnregisteredCommands,
  getActionRegistry,
  getRegisteredAction,
} from "../../lib/project-intelligence/platform/action-registry";

// Рантайм-список команд из самого контракта (zod discriminated union под
// ZodEffects — разворачиваем обёртку). Источник имён — контракт, не ручной
// список в тесте.
function unwrapDiscriminatedUnion(schema: {
  _def?: { schema?: unknown };
}): { options: Array<{ shape: { kind: { value: string } } }> } {
  let inner = schema as unknown as {
    options?: Array<{ shape: { kind: { value: string } } }>;
    _def?: { schema?: unknown };
  };
  let guard = 0;
  while (!Array.isArray(inner.options) && guard < 10) {
    inner = (inner._def?.schema ?? {}) as typeof inner;
    guard += 1;
  }
  if (!Array.isArray(inner.options)) {
    throw new Error("command contract: discriminated union not found");
  }
  return inner as { options: Array<{ shape: { kind: { value: string } } }> };
}

const contractKinds = unwrapDiscriminatedUnion(
  projectCeoCommandSchema,
).options.map((option) => option.shape.kind.value);

describe("Action/Skill Registry (Фаза 2, A3)", () => {
  it("покрывает ВСЕ команды контракта — неучтённая команда роняет CI (A6 §5.1)", () => {
    const missing = findUnregisteredCommands(contractKinds);
    expect(missing, `не в реестре: ${missing.join(", ")}`).toEqual([]);
  });

  it("не содержит призраков — команд вне контракта в реестре нет", () => {
    const ghosts = findRegistryGhosts(contractKinds);
    expect(ghosts, `призраки: ${ghosts.join(", ")}`).toEqual([]);
  });

  it("каждая запись имеет основание-документ и валидный модуль", () => {
    const validModules = new Set(["access", "m2", "m3", "m4", "platform"]);
    for (const action of getActionRegistry()) {
      expect(action.basis.length, action.kind).toBeGreaterThan(0);
      expect(validModules.has(action.module), action.kind).toBe(true);
    }
  });

  it("capability ссылается только на существующие capability контракта ролей", async () => {
    // Единый источник имён capability — components/projectceo/contracts
    // (тот же, что использует role-policy и БД-миграция 20260802030000).
    const { PROJECTCEO_CAPABILITIES } = await import(
      "../../components/projectceo/contracts"
    );
    const known = new Set(PROJECTCEO_CAPABILITIES as readonly string[]);
    for (const action of getActionRegistry()) {
      if (action.capability !== null) {
        expect(
          known.has(action.capability),
          `${action.kind}: неизвестная capability ${action.capability}`,
        ).toBe(true);
      }
    }
  });

  it("закрытые двери V2/V3 и truncation помечены not_authorized/worker_only", () => {
    const closed = [
      "acknowledge_impact_truncation",
      "upload_photo_evidence",
      "review_photo_evidence",
      "accept_milestone",
    ];
    for (const kind of closed) {
      expect(getRegisteredAction(kind)?.status, kind).toBe("not_authorized");
    }
    expect(getRegisteredAction("build_handover")?.status).toBe("worker_only");
  });

  it("инкремент 1 и V1 активны с capability из A6/DEC-033", () => {
    for (const kind of [
      "distribute_release",
      "acknowledge_release",
      "create_change",
      "review_change_impact",
    ]) {
      const action = getRegisteredAction(kind);
      expect(action?.status, kind).toBe("active");
      expect(action?.capability, kind).toBeTruthy();
    }
  });
});
