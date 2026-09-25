// DEC-040 (4): baseline M3 публикуется только с опубликованной передачей M2→M3
// по каждому пакету baseline (миграция 20260925100000). Ссылки выводит сервер
// из того же authenticated-чтения, что и остальной состав baseline (A′):
// клиент их не присылает и не выдумывает. База перепроверяет каждую ссылку —
// «последняя опубликованная ревизия передачи этого пакета».

export interface HandoffCandidate {
  readonly id: string;
  readonly packageId: string;
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly createdAt: string;
}

export interface BaselineHandoffRef {
  readonly packageId: string;
  readonly handoffId: string;
  readonly handoffRevisionId: string;
}

export type BaselineHandoffRefsResult =
  | { readonly ok: true; readonly refs: readonly BaselineHandoffRef[] }
  | { readonly ok: false; readonly missingPackageIds: readonly string[] };

export function baselineHandoffRefs(
  packageIds: readonly string[],
  handoffs: readonly HandoffCandidate[],
): BaselineHandoffRefsResult {
  // Последняя ревизия каждой передачи.
  const latestRevision = new Map<string, HandoffCandidate>();
  for (const handoff of handoffs) {
    const current = latestRevision.get(handoff.id);
    if (!current || handoff.revisionNo > current.revisionNo) latestRevision.set(handoff.id, handoff);
  }
  // По пакету — самая свежая передача (при равенстве — детерминированно по id).
  const byPackage = new Map<string, HandoffCandidate>();
  for (const handoff of latestRevision.values()) {
    const current = byPackage.get(handoff.packageId);
    if (
      !current
      || handoff.createdAt > current.createdAt
      || (handoff.createdAt === current.createdAt && handoff.id > current.id)
    ) {
      byPackage.set(handoff.packageId, handoff);
    }
  }
  const missingPackageIds = packageIds.filter((packageId) => !byPackage.has(packageId));
  if (missingPackageIds.length > 0) return { ok: false, missingPackageIds };
  return {
    ok: true,
    refs: packageIds.map((packageId) => {
      const handoff = byPackage.get(packageId)!;
      return { packageId, handoffId: handoff.id, handoffRevisionId: handoff.revisionId };
    }),
  };
}
