import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { projectCeoCommandSchema } from "../../lib/project-intelligence/delivery/projectceo/command-contract";
import {
  AP5_DECISION_NODE_ID,
  AP5_DECISION_REVISION_ID,
  AP5_DECISION_REVISION_ID_2,
  AP5_SOURCE_NAME,
  AP5_SOURCE_REVISION_ID,
} from "../ap5/ap5-env";

/**
 * Офлайновый гейт идентификаторов цепочки Kora.
 *
 * Прогон 156: шаг 5 послал `revisionId: "ap5-decision-revision-1"` в поле,
 * которое контракт объявляет uuid. Маршрут отклонил конверт до всякого RPC и
 * ответил 400 `validation_failed` — тем же кодом, каким отвечает и настоящий
 * отказ базы. По артефакту различить их было нельзя, и целая сессия ушла на
 * поиск несуществующего дефекта сервера при живом Supabase.
 *
 * Этот тест стоит 20 миллисекунд и не требует стека: он гоняет идентификаторы
 * AP5 через тот же `projectCeoCommandSchema`, что и маршрут. Если значение
 * снова разойдётся с контрактом, `npm run test` скажет об этом на push, а не
 * сорокапятиминутный браузерный прогон.
 */
const projectId = "11111111-1111-4111-8111-111111111111";
const commandId = "22222222-2222-4222-8222-222222222222";
const rootPackageId = projectId;

function envelope(kind: string, payload: Record<string, unknown>) {
  return {
    contractVersion: "projectceo-command/0.1",
    kind,
    projectId,
    commandId,
    payload,
  };
}

function parse(kind: string, payload: Record<string, unknown>) {
  const result = projectCeoCommandSchema.safeParse(envelope(kind, payload));
  return result.success ? null : JSON.stringify(result.error.issues);
}

describe("AP5 chain identifiers satisfy the command contract", () => {
  it("3. register_source carries the source revision the chain reuses", () => {
    expect(parse("register_source", {
      packageId: rootPackageId,
      physicalRecordId: "33333333-3333-4333-8333-333333333333",
      sanitizedName: AP5_SOURCE_NAME,
      floorId: "floor-1",
      zoneId: "zone-a",
      disciplineId: "architectural",
      availability: "materialized",
      documentStatus: "current",
      sizeBytes: 1024,
      checksum: createHash("sha256").update(AP5_SOURCE_NAME).digest("hex"),
      sourceRevisionId: AP5_SOURCE_REVISION_ID,
    })).toBeNull();
  });

  it("4. review_source addresses that same revision", () => {
    expect(parse("review_source", {
      targetRevisionId: AP5_SOURCE_REVISION_ID,
      expectedRevisionId: AP5_SOURCE_REVISION_ID,
      decision: "confirmed",
    })).toBeNull();
  });

  it("5. create_decision revisionId is a uuid, as the contract demands", () => {
    expect(parse("create_decision", {
      packageId: rootPackageId,
      nodeId: AP5_DECISION_NODE_ID,
      revisionId: AP5_DECISION_REVISION_ID,
      expectedRevisionId: null,
      claimStatus: "human_origin",
      title: "AP5 decision",
      resolution: "AP5 chain decision recorded from an authenticated architect session.",
      areaNodeId: null,
      decisionStatus: "confirmed",
      evidence: [],
      reason: "AP5 authenticated browser chain",
    })).toBeNull();
  });

  it("6. create_approval_package approves exactly the revision step 5 created", () => {
    expect(parse("create_approval_package", {
      packageId: rootPackageId,
      approvalPackageId: "ap5-approval-33333333-3333-4333-8333-333333333333",
      items: [{
        targetKind: "decision_revision",
        entityId: AP5_DECISION_NODE_ID,
        revisionId: AP5_DECISION_REVISION_ID,
      }],
    })).toBeNull();
  });

  // Звенья гейта 2. Payload здесь собирается из значений, которые прогон берёт
  // из проекции (идентификатор версии пакета, получатель, идентификатор
  // выдачи), поэтому проверяются их ФОРМЫ: версия пакета — свободный текст,
  // получатель и выдача — uuid. Ошибка формы в спеке стоила бы сорока пяти
  // минут прогона и выглядела бы как отказ сервера.
  it("9. distribute_release addresses a text version id and a uuid recipient", () => {
    expect(parse("distribute_release", {
      productionPackageVersionId: "package-ap5-root-v1",
      recipientUserId: "44444444-4444-4444-8444-444444444444",
    })).toBeNull();
  });

  it("10. acknowledge_release addresses the distribution by uuid", () => {
    expect(parse("acknowledge_release", {
      distributionId: "55555555-5555-4555-8555-555555555555",
    })).toBeNull();
  });

  it("11. the revised decision keeps the node and replaces the revision", () => {
    // Заявка на изменение требует расхождения между baseline, а расхождение —
    // это ОДНА сущность с РАЗНЫМИ ревизиями. Ошибка здесь (новый nodeId вместо
    // новой ревизии) дала бы `NO_CHANGE_ROOTS` на живом стеке.
    expect(AP5_DECISION_REVISION_ID_2).not.toBe(AP5_DECISION_REVISION_ID);
    expect(parse("create_decision", {
      packageId: rootPackageId,
      nodeId: AP5_DECISION_NODE_ID,
      revisionId: AP5_DECISION_REVISION_ID_2,
      expectedRevisionId: AP5_DECISION_REVISION_ID,
      claimStatus: "human_origin",
      title: "AP5 decision (revised)",
      resolution: "AP5 chain decision revised from an authenticated architect session.",
      areaNodeId: null,
      decisionStatus: "confirmed",
      evidence: [],
      reason: "AP5 authenticated browser chain — revision for the change request",
    })).toBeNull();
  });

  it("11. create_change carries integer deltas and the previous version id", () => {
    expect(parse("create_change", {
      reason: "AP5: на объекте вскрылось расхождение с выпущенной редакцией",
      fromProductionPackageVersionId: "package-ap5-root-v1",
      deltaCostRub: 0,
      deltaDays: 0,
    })).toBeNull();
  });

  // Шаг 8 посылает заведомо закрытую команду инкремента 2 и ждёт отказа
  // сервера. Отказ обязан быть по неавторизованному инкременту, а не по
  // контракту, — иначе шаг доказывал бы работу валидатора, а не запрета.
  it("8. the increment 2 probe is contract-valid, so its refusal is the module's", () => {
    expect(parse("accept_milestone", {
      milestoneId: "a5d0c1c1-0000-4000-8000-00000000dead",
    })).toBeNull();
  });

  // Негативный контроль: без него тест выше зелёный и когда схема перестала
  // проверять поле вовсе.
  it("rejects the non-uuid revision id that failed run 156", () => {
    expect(parse("create_decision", {
      packageId: rootPackageId,
      nodeId: AP5_DECISION_NODE_ID,
      revisionId: "ap5-decision-revision-1",
      expectedRevisionId: null,
      claimStatus: "human_origin",
      title: "AP5 decision",
      resolution: "AP5 chain decision recorded from an authenticated architect session.",
      areaNodeId: null,
      decisionStatus: "confirmed",
      evidence: [],
      reason: "AP5 authenticated browser chain",
    })).toContain("payload\",\"revisionId");
  });
});
