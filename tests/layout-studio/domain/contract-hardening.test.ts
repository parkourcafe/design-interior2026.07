import { describe, expect, it } from "vitest";

import syntheticFixture from "@/fixtures/layout-studio/liquid-station.synthetic.v0.1.json";
import {
  applyLayoutCommand,
  validateLayoutDocument,
  type LayoutCommand,
  type LayoutDocument,
} from "@/lib/layout-studio/domain";

function makeDocument(): LayoutDocument {
  return structuredClone(syntheticFixture) as unknown as LayoutDocument;
}

function expectBlockingRejection(document: LayoutDocument): void {
  const result = validateLayoutDocument(document);

  expect(result.valid).toBe(false);
  expect(result.issues).toEqual(
    expect.arrayContaining([expect.objectContaining({ severity: "blocking" })]),
  );
}

describe("LS-010: LayoutDocument schema and reference hardening", () => {
  it.each([
    [
      "missing required root field",
      (document: LayoutDocument) => {
        delete (document as unknown as Record<string, unknown>).lights;
      },
    ],
    [
      "unknown root field",
      (document: LayoutDocument) => {
        (document as unknown as Record<string, unknown>).rendererState = {};
      },
    ],
    [
      "unknown nested field",
      (document: LayoutDocument) => {
        (document.materials[0] as unknown as Record<string, unknown>).glossiness = 0.5;
      },
    ],
  ])("rejects a document with a %s", (_case, mutate) => {
    const document = makeDocument();
    mutate(document);

    expectBlockingRejection(document);
  });

  it.each([
    [
      "missing assignment target",
      (document: LayoutDocument) => {
        document.materialAssignments[0]!.targetId = "wall.synthetic-liquid-station.missing";
      },
    ],
    [
      "missing assigned material",
      (document: LayoutDocument) => {
        document.materialAssignments[0]!.materialId =
          "material.synthetic-liquid-station.missing";
      },
    ],
    [
      "roughness above the PBR range",
      (document: LayoutDocument) => {
        document.materials[0]!.roughness = 1.01;
      },
    ],
    [
      "metalness below the PBR range",
      (document: LayoutDocument) => {
        document.materials[1]!.metalness = -0.01;
      },
    ],
    [
      "emissive intensity above its range",
      (document: LayoutDocument) => {
        document.materials[2]!.emissiveIntensity = 100.01;
      },
    ],
  ])("rejects an invalid material contract: %s", (_case, mutate) => {
    const document = makeDocument();
    mutate(document);

    expectBlockingRejection(document);
  });

  it.each([
    [
      "missing target reference",
      (document: LayoutDocument) => {
        document.lights[0]!.targetId = "object.synthetic-liquid-station.missing";
      },
    ],
    [
      "malformed color",
      (document: LayoutDocument) => {
        document.lights[0]!.color = "warm-white";
      },
    ],
    [
      "negative intensity",
      (document: LayoutDocument) => {
        document.lights[0]!.intensity = -1;
      },
    ],
    [
      "intensity above the schema maximum",
      (document: LayoutDocument) => {
        document.lights[0]!.intensity = 100_001;
      },
    ],
    [
      "fractional canonical coordinate",
      (document: LayoutDocument) => {
        document.lights[0]!.xMm = 3500.5;
      },
    ],
  ])("rejects an invalid light contract: %s", (_case, mutate) => {
    const document = makeDocument();
    mutate(document);

    expectBlockingRejection(document);
  });
});

describe("LS-011/LS-AT-054: ASSIGN_MATERIAL", () => {
  it("immutably updates an existing stable assignment and increments the revision", () => {
    const original = makeDocument();
    const before = structuredClone(original);
    const assignment = original.materialAssignments.find(
      ({ id }) => id === "assignment.synthetic-liquid-station.sink",
    )!;
    const command = {
      commandId: "command.synthetic-liquid-station.assign-sink-patina",
      idempotencyKey: "idem.synthetic-liquid-station.assign-sink-patina",
      documentId: original.documentId,
      expectedStateRevision: original.stateRevision,
      type: "ASSIGN_MATERIAL",
      payload: {
        assignmentId: assignment.id,
        materialId: "material.synthetic-liquid-station.copper-patina",
      },
      reasonCode: "USER_MATERIAL_EDIT",
      reason: "Проверка стабильного назначения материала",
    } as unknown as LayoutCommand;

    const result = applyLayoutCommand(original, command);
    const updated = result.document.materialAssignments.find(({ id }) => id === assignment.id);

    expect(result.ok).toBe(true);
    expect(original).toEqual(before);
    expect(result.document).not.toBe(original);
    expect(result.document.stateRevision).toBe(original.stateRevision + 1);
    expect(updated).toEqual({
      ...assignment,
      materialId: "material.synthetic-liquid-station.copper-patina",
    });
  });
});
