import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { applyLayoutCommand, type LayoutDocument } from "@/lib/layout-studio/domain";
import { compileMaterialDescriptors } from "@/lib/layout-studio/adapters/three/material-compiler";
import koraFixture from "@/fixtures/layout-studio/kora-liquid-station.v0.1.json";

const repoRoot = process.cwd();
const KORA = koraFixture as unknown as LayoutDocument;

/**
 * LS-AT-054 — material assignment is canonical only. The editor must have no
 * side door that writes materialAssignments outside ASSIGN_MATERIAL, and the
 * renderer must read its colours from the canonical document.
 */
describe("LS-AT-054: canonical material assignment", () => {
  it("changes an assignment only through the ASSIGN_MATERIAL command", () => {
    const target = KORA.materialAssignments[0];
    if (!target) throw new Error("KORA fixture must define at least one material assignment");

    const result = applyLayoutCommand(KORA, {
      commandId: "command.test.assign",
      idempotencyKey: "test:assign-material",
      documentId: KORA.documentId,
      expectedStateRevision: KORA.stateRevision,
      reasonCode: "TEST",
      reason: "Смена материала",
      type: "ASSIGN_MATERIAL",
      payload: { assignmentId: target.id, materialId: "material.kora.steel" },
    });

    expect(result.ok).toBe(true);
    expect(result.document.stateRevision).toBe(KORA.stateRevision + 1);
    const applied = result.document.materialAssignments.find(
      (assignment) => assignment.targetId === target.targetId,
    );
    expect(applied?.materialId).toBe("material.kora.steel");
    // The source document is untouched.
    expect(KORA.materialAssignments[0]?.materialId).toBe(target.materialId);
  });

  it("rejects an assignment that names a material the document does not define", () => {
    const result = applyLayoutCommand(KORA, {
      commandId: "command.test.assign-missing",
      idempotencyKey: "test:assign-missing",
      documentId: KORA.documentId,
      expectedStateRevision: KORA.stateRevision,
      reasonCode: "TEST",
      reason: "Несуществующий материал",
      type: "ASSIGN_MATERIAL",
      payload: {
        assignmentId: KORA.materialAssignments[0]?.id ?? "",
        materialId: "material.does-not-exist",
      },
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("MATERIAL_NOT_FOUND");
  });

  it("renders every material from the canonical document, never from a UI literal", () => {
    const descriptors = compileMaterialDescriptors(KORA);
    expect(descriptors).toHaveLength(KORA.materialAssignments.length);

    const canonical = new Map(KORA.materials.map((material) => [material.id, material]));
    for (const descriptor of descriptors) {
      const source = canonical.get(descriptor.materialId);
      expect(source, `material ${descriptor.materialId} must be canonical`).toBeDefined();
      expect(descriptor.color).toBe(source?.baseColor);
      expect(descriptor.roughness).toBe(source?.roughness);
      expect(descriptor.metalness).toBe(source?.metalness);
    }
  });

  it("keeps the editor shell free of any non-canonical material write", () => {
    const shell = readFileSync(
      join(repoRoot, "components/layout-studio/layout-studio-shell.tsx"),
      "utf8",
    );

    // No assignment list mutation, and no hand-rolled PBR values in the UI.
    expect(shell).not.toMatch(/materialAssignments\s*(?:=|\.push|\.splice|\[)/);
    expect(shell).not.toMatch(/materials\s*(?:=|\.push|\.splice)/);
    expect(shell).not.toMatch(/roughness:\s*[\d.]/);
    expect(shell).not.toMatch(/metalness:\s*[\d.]/);
    // Material data reaches Three only through the canonical compiler.
    expect(shell).toContain("compileMaterialDescriptors");
  });
});
