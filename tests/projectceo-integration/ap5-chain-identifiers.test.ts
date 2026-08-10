import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { projectCeoCommandSchema } from "../../lib/project-intelligence/delivery/projectceo/command-contract";
import {
  AP5_DECISION_NODE_ID,
  AP5_DECISION_REVISION_ID,
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
