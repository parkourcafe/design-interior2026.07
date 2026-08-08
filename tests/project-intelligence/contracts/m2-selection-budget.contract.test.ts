import { describe, expect, it } from 'vitest';
import {
  createRoomDesignIntent,
  type DesignIntentVariantInput,
} from '@/lib/project-intelligence/modules/design-intent';
import { createDesignIntentBudget } from '@/lib/project-intelligence/modules/design-intent/budget';
import {
  DecisionContractError,
  type EvidenceReference,
  type HumanActorRef,
  type PriceObservation,
  type SelectionRevision,
} from '@/lib/project-intelligence/modules/decisions';

const actor: HumanActorRef = { actorId: 'actor-designer-1', actorType: 'human' };
const evidence: EvidenceReference = {
  evidenceId: 'evidence-catalog-1',
  sourceId: 'source-catalog-1',
  sourceRevisionId: 'source-catalog-1@7',
  fragmentId: 'catalog/items/42',
};

const variants: readonly DesignIntentVariantInput[] = [
  { variantId: 'variant-preferred', role: 'preferred', projectId: 'project-1', packageId: 'package-1', roomId: 'room-living', layoutDocumentId: 'layout-preferred', layoutVersionId: 'layout-preferred@1', semanticHash: 'sha256:preferred' },
  { variantId: 'variant-value-engineered', role: 'value_engineered', projectId: 'project-1', packageId: 'package-1', roomId: 'room-living', layoutDocumentId: 'layout-value-engineered', layoutVersionId: 'layout-value-engineered@2', semanticHash: 'sha256:value-engineered' },
  { variantId: 'variant-premium', role: 'premium', projectId: 'project-1', packageId: 'package-1', roomId: 'room-living', layoutDocumentId: 'layout-premium', layoutVersionId: 'layout-premium@3', semanticHash: 'sha256:premium' },
];

const intent = createRoomDesignIntent({
  designIntentId: 'intent-room-living', projectId: 'project-1', packageId: 'package-1', roomId: 'room-living',
  revision: { revisionId: 'intent-room-living@1', revisionNo: 1, createdAt: '2026-07-01T10:00:00.000Z', createdBy: actor, reason: 'Первый согласованный набор вариантов' },
  variants,
});

function observation(id: string, selectionRevisionId: string, amountRub: number, observedAt: string, supplierRef = `supplier:${id}`): PriceObservation {
  return { id, projectId: 'project-1', selectionRevisionId, amountRub, observedAt, evidence, supplierRef };
}

function selection(id: string, prices: readonly PriceObservation[], overrides: Partial<SelectionRevision> = {}): SelectionRevision {
  return {
    id, projectId: 'project-1', entityId: `entity:${id}`, revisionNo: 1, kind: 'selection', title: id,
    areaId: 'room-living', packageId: 'package-1', decisionRevisionId: 'decision@1', specification: { sku: id },
    claimStatus: 'human_origin', reviewStatus: 'approved', evidence: [evidence], priceObservations: [...prices],
    createdAt: '2026-07-01T10:00:00.000Z', createdBy: actor, reason: 'Точная ревизия выбора', replacesRevisionId: null,
    ...overrides,
  };
}

const bindings = [
  { variantId: 'variant-preferred', selectionRevisionIds: ['selection-sofa@1'] },
  { variantId: 'variant-value-engineered', selectionRevisionIds: ['selection-sofa@1', 'selection-light@1'] },
  { variantId: 'variant-premium', selectionRevisionIds: ['selection-light@1'] },
] as const;
const asOf = '2026-07-20T00:00:00.000Z';

function validSelections(): SelectionRevision[] {
  return [
    selection('selection-sofa@1', [observation('price-sofa', 'selection-sofa@1', 180_000, '2026-07-15T00:00:00.000Z')]),
    selection('selection-light@1', [observation('price-light', 'selection-light@1', 70_000, '2026-07-10T00:00:00.000Z')]),
  ];
}

function expectCode(run: () => unknown, code: string): void {
  try { run(); throw new Error(`Expected ${code}`); } catch (error) {
    expect(error).toBeInstanceOf(DecisionContractError);
    expect(error).toMatchObject({ code });
  }
}

describe('M2 SelectionRevision Design Intent budget contract', () => {
  it('builds all three role budgets, selects the latest eligible price deterministically, and reports stale and missing prices', () => {
    const selections = [
      selection('selection-sofa@1', [
        observation('price-z', 'selection-sofa@1', 190_000, '2026-07-15T00:00:00.000Z'),
        observation('price-a', 'selection-sofa@1', 180_000, '2026-07-15T00:00:00.000Z'),
        observation('price-future', 'selection-sofa@1', 999_999, '2026-07-21T00:00:00.000Z'),
      ]),
      selection('selection-light@1', [observation('price-old', 'selection-light@1', 70_000, '2026-06-01T00:00:00.000Z')]),
      selection('selection-no-price@1', [observation('price-only-future', 'selection-no-price@1', 50_000, '2026-07-22T00:00:00.000Z')]),
    ];
    const result = createDesignIntentBudget({
      intent, selections,
      bindings: [bindings[0], bindings[1], { variantId: 'variant-premium', selectionRevisionIds: ['selection-light@1', 'selection-no-price@1'] }],
      asOf, staleAfterDays: 30,
    });
    expect(result).toEqual({
      designIntentId: 'intent-room-living', asOf, staleAfterDays: 30,
      variantBudgets: [
        { variantId: 'variant-preferred', role: 'preferred', amountRub: 180_000, pricedSelectionRevisionIds: ['selection-sofa@1'], staleSelectionRevisionIds: [], missingPriceSelectionRevisionIds: [] },
        { variantId: 'variant-value-engineered', role: 'value_engineered', amountRub: 250_000, pricedSelectionRevisionIds: ['selection-sofa@1', 'selection-light@1'], staleSelectionRevisionIds: ['selection-light@1'], missingPriceSelectionRevisionIds: [] },
        { variantId: 'variant-premium', role: 'premium', amountRub: 70_000, pricedSelectionRevisionIds: ['selection-light@1'], staleSelectionRevisionIds: ['selection-light@1'], missingPriceSelectionRevisionIds: ['selection-no-price@1'] },
      ],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.variantBudgets)).toBe(true);
    expect(result.variantBudgets.every(Object.isFrozen)).toBe(true);
    expect(result.variantBudgets.every((budget) => Object.isFrozen(budget.pricedSelectionRevisionIds) && Object.isFrozen(budget.staleSelectionRevisionIds) && Object.isFrozen(budget.missingPriceSelectionRevisionIds))).toBe(true);
  });

  it('does not mutate the intent, selections, observations, or bindings', () => {
    const selections = validSelections();
    const before = JSON.stringify({ intent, selections, bindings });
    createDesignIntentBudget({ intent, selections, bindings, asOf, staleAfterDays: 30 });
    expect(JSON.stringify({ intent, selections, bindings })).toBe(before);
  });

  it.each([
    ['duplicate bindings', [...bindings, bindings[0]], 'DESIGN_BUDGET_DUPLICATE_BINDING'],
    ['missing variant binding', bindings.slice(0, 2), 'DESIGN_BUDGET_MISSING_VARIANT_BINDING'],
    ['duplicate selection IDs', [{ variantId: 'variant-preferred', selectionRevisionIds: ['selection-sofa@1', 'selection-sofa@1'] }, bindings[1], bindings[2]], 'DESIGN_BUDGET_DUPLICATE_SELECTION'],
    ['unknown variant', [bindings[0], bindings[1], { variantId: 'variant-unknown', selectionRevisionIds: ['selection-light@1'] }], 'DESIGN_BUDGET_UNKNOWN_VARIANT'],
    ['unknown selection', [{ variantId: 'variant-preferred', selectionRevisionIds: ['selection-unknown@1'] }, bindings[1], bindings[2]], 'DESIGN_BUDGET_UNKNOWN_SELECTION'],
  ])('rejects %s', (_label, invalidBindings, code) => {
    expectCode(() => createDesignIntentBudget({ intent, selections: validSelections(), bindings: invalidBindings, asOf, staleAfterDays: 30 }), code);
  });

  it.each([
    ['project', { projectId: 'project-other' }],
    ['package', { packageId: 'package-other' }],
    ['room', { areaId: 'room-kitchen' }],
  ])('rejects a selection with mismatched %s scope', (_label, overrides) => {
    const selections = validSelections();
    selections[0] = selection('selection-sofa@1', [observation('price-sofa', 'selection-sofa@1', 180_000, asOf)], overrides);
    expectCode(() => createDesignIntentBudget({ intent, selections, bindings, asOf, staleAfterDays: 30 }), 'DESIGN_BUDGET_SCOPE_MISMATCH');
  });

  it.each([
    ['invalid asOf', 'not-a-timestamp', 30, 'DESIGN_BUDGET_INVALID_AS_OF'],
    ['zero staleAfterDays', asOf, 0, 'DESIGN_BUDGET_INVALID_STALE_AFTER_DAYS'],
    ['negative staleAfterDays', asOf, -1, 'DESIGN_BUDGET_INVALID_STALE_AFTER_DAYS'],
    ['fractional staleAfterDays', asOf, 1.5, 'DESIGN_BUDGET_INVALID_STALE_AFTER_DAYS'],
  ])('rejects %s', (_label, invalidAsOf, staleAfterDays, code) => {
    expectCode(() => createDesignIntentBudget({ intent, selections: validSelections(), bindings, asOf: invalidAsOf, staleAfterDays }), code);
  });

  it('rejects missing exact selection evidence and empty supplier provenance', () => {
    const missingEvidence = validSelections();
    missingEvidence[0] = selection('selection-sofa@1', [observation('price-sofa', 'selection-sofa@1', 180_000, asOf)], { evidence: [] });
    expectCode(() => createDesignIntentBudget({ intent, selections: missingEvidence, bindings, asOf, staleAfterDays: 30 }), 'DESIGN_BUDGET_INVALID_SELECTION');
    const emptySupplier = validSelections();
    emptySupplier[0] = selection('selection-sofa@1', [observation('price-sofa', 'selection-sofa@1', 180_000, asOf, '')]);
    expectCode(() => createDesignIntentBudget({ intent, selections: emptySupplier, bindings, asOf, staleAfterDays: 30 }), 'DESIGN_BUDGET_INVALID_PRICE_OBSERVATION');
  });

  it('rejects an unsafe integer RUB total', () => {
    const selections = [
      selection('selection-sofa@1', [observation('price-sofa', 'selection-sofa@1', Number.MAX_SAFE_INTEGER, asOf)]),
      selection('selection-light@1', [observation('price-light', 'selection-light@1', 1, asOf)]),
    ];
    const overflowBindings = [
      { variantId: 'variant-preferred', selectionRevisionIds: ['selection-sofa@1', 'selection-light@1'] }, bindings[1], bindings[2],
    ] as const;
    expectCode(() => createDesignIntentBudget({ intent, selections, bindings: overflowBindings, asOf, staleAfterDays: 30 }), 'DESIGN_BUDGET_UNSAFE_TOTAL');
  });
});
