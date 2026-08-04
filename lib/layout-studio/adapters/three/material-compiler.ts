import type { LayoutDocument } from "@/lib/layout-studio/domain";

export interface MaterialDescriptor {
  assignmentId: string;
  targetId: string;
  surfaceRole: string;
  materialId: string;
  color: string;
  roughness: number;
  metalness: number;
  emissive: string;
  emissiveIntensity: number;
}

export function compileMaterialDescriptors(
  document: LayoutDocument,
): MaterialDescriptor[] {
  const materials = new Map(document.materials.map((material) => [material.id, material]));

  return document.materialAssignments.flatMap((assignment) => {
    const material = materials.get(assignment.materialId);
    if (!material) return [];
    return [{
      assignmentId: assignment.id,
      targetId: assignment.targetId,
      surfaceRole: assignment.surfaceRole,
      materialId: material.id,
      color: material.baseColor,
      roughness: material.roughness,
      metalness: material.metalness,
      emissive: material.emissive,
      emissiveIntensity: material.emissiveIntensity,
    }];
  });
}
