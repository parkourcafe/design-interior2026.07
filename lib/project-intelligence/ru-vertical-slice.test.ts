import { describe, expect, it } from 'vitest';
import { buildRuWbs, canAdvanceProcurement, canHandover, estimateRuRub, validateRuChangeOrder, validateRuImportPackage } from './ru-vertical-slice';

describe('RU ProUp vertical slice seams', () => {
  it('validates imported package provenance', () => {
    const errors = validateRuImportPackage({ projectId: 'p1', sourceRevision: 'r1', importedAt: '2026-07-16T00:00:00Z', items: [{ id: 'a', format: 'pdf', fileName: 'plan.pdf', sha256: 'a'.repeat(64) }] });
    expect(errors).toEqual([]);
  });

  it('builds room work breakdown with deterministic dependencies', () => {
    const wbs = buildRuWbs({ projectId: 'p1', version: 'v1', rooms: [], materials: [], workItems: [
      { id: 'w1', roomId: 'kitchen', title: 'Демонтаж', discipline: 'general' },
      { id: 'w2', roomId: 'kitchen', title: 'Монтаж', discipline: 'general' },
    ] });
    expect(wbs[0]!.dependsOn).toEqual([]);
    expect(wbs[1]!.dependsOn).toEqual(['w1']);
  });

  it('keeps estimate in integer roubles', () => {
    expect(estimateRuRub([{ id: 'x', kind: 'work', title: 'Работа', qty: 2, unitCostRub: 1500 }])).toBe(3000);
  });

  it('allows only sequential procurement transitions', () => {
    expect(canAdvanceProcurement('planned', 'requested')).toBe(true);
    expect(canAdvanceProcurement('planned', 'paid')).toBe(false);
  });

  it('requires reason and integer deltas for change orders', () => {
    expect(validateRuChangeOrder({ id: 'c1', baselineVersion: 'v1', reason: '', initiatedBy: 'client', deltaCostRub: 1.2, deltaDays: 1.5, status: 'draft' })).toEqual(['change_reason_required', 'delta_days_must_be_integer', 'delta_cost_must_be_integer_rub']);
  });

  it('requires accepted room and accepted photo before handover', () => {
    const handover = { projectId: 'p1', baselineVersion: 'v1', acceptedRooms: ['kitchen'], warrantyArchivePaths: [], generatedAt: '2026-07-16T00:00:00Z', semanticHash: 'hash' };
    expect(canHandover(handover, [{ id: 'r1', roomId: 'kitchen', capturedAt: '2026-07-16T00:00:00Z', storagePath: 'p/r1.jpg', accepted: true }])).toBe(true);
  });
});
