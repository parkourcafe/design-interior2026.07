import { describe, expect, it } from 'vitest';
import type { RoomDesignIntent } from '@/lib/project-intelligence/modules/design-intent';
import type { DesignIntentBudget } from '@/lib/project-intelligence/modules/design-intent/budget';
import type { HumanActorRef, SelectionRevision } from '@/lib/project-intelligence/modules/decisions';
import { DecisionContractError } from '@/lib/project-intelligence/modules/decisions';
import {
  createM2ApprovalSubmission,
  reviewM2ApprovalSubmission,
  createApprovedM2Commit,
} from '@/lib/project-intelligence/application/m2-approval';

const designer: HumanActorRef = { actorId: 'designer-1', actorType: 'human' };
const client: HumanActorRef = { actorId: 'client-1', actorType: 'human' };

const intent = {
  designIntentId: 'intent-1',
  projectId: 'project-1',
  packageId: 'package-1',
  roomId: 'room-1',
  revision: {
    revisionId: 'intent-r2',
    revisionNo: 2,
    createdAt: '2026-08-01T09:00:00.000Z',
    createdBy: designer,
    reason: 'Client-ready revision',
  },
  variants: [{
    variantId: 'variant-a',
    role: 'preferred',
    projectId: 'project-1',
    packageId: 'package-1',
    roomId: 'room-1',
    layoutDocumentId: 'layout-a',
    layoutVersionId: 'layout-a-v3',
    semanticHash: 'sha256:layout-a-v3',
  }],
} as RoomDesignIntent;

const selection = {
  id: 'selection-chair-r4',
  projectId: 'project-1',
  entityId: 'selection-chair',
  revisionNo: 4,
  kind: 'selection',
  title: 'Chair',
  areaId: 'room-1',
  packageId: 'package-1',
  decisionRevisionId: 'decision-chair-r1',
  specification: { quantity: '2', material: 'Oak' },
  claimStatus: 'human_origin',
  reviewStatus: 'approved',
  evidence: [],
  priceObservations: [],
  createdAt: '2026-08-01T10:00:00.000Z',
  createdBy: designer,
  reason: 'Approved fabric',
  replacesRevisionId: null,
} as SelectionRevision;

const selections: SelectionRevision[] = [selection];
const selectionRevisionIds = ['selection-chair-r4'];

const budget = {
  designIntentId: 'intent-1',
  asOf: '2026-08-01T12:00:00.000Z',
  staleAfterDays: 14,
  variantBudgets: [{
    variantId: 'variant-a',
    role: 'preferred',
    amountRub: 240000,
    pricedSelectionRevisionIds: ['selection-chair-r4'],
    staleSelectionRevisionIds: [],
    missingPriceSelectionRevisionIds: [],
  }],
} as DesignIntentBudget;

const submittedAt = '2026-08-02T09:00:00.000Z';
const reviewedAt = '2026-08-03T09:00:00.000Z';

function createSubmission() {
  return createM2ApprovalSubmission({
    submissionId: 'm2-submission-1',
    intent,
    chosenVariantId: 'variant-a',
    selectionRevisionIds,
    selections,
    budget,
    submittedBy: designer,
    submittedAt,
    reason: 'Please approve the room package',
  });
}

function createApprovedSubmission() {
  return reviewM2ApprovalSubmission({
    submission: createSubmission(),
    decision: 'approved',
    reviewedBy: client,
    reviewedAt,
    reason: 'Approved for production',
  });
}

function commitInput() {
  return {
    approvedSubmission: createApprovedSubmission(),
    currentIntent: intent,
    currentSelections: selections,
    recalculatedBudget: budget,
  };
}

function expectCode(action: () => unknown, code: string) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(DecisionContractError);
    expect((error as DecisionContractError & { code: string }).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe('M2 human approval and immutable commit', () => {
  it('requires human actors, a distinct reviewer, and chronological review', () => {
    const system = { actorId: 'ai-1', actorType: 'system' } as unknown as HumanActorRef;
    expectCode(() => createM2ApprovalSubmission({
      submissionId: 'system-submission', intent, chosenVariantId: 'variant-a', selectionRevisionIds,
      selections, budget, submittedBy: system, submittedAt, reason: 'AI submission',
    }), 'M2_APPROVAL_HUMAN_REQUIRED');
    expectCode(() => reviewM2ApprovalSubmission({
      submission: createSubmission(), decision: 'approved', reviewedBy: system, reviewedAt,
      reason: 'AI approval',
    }), 'M2_APPROVAL_HUMAN_REQUIRED');
    expectCode(() => reviewM2ApprovalSubmission({
      submission: createSubmission(), decision: 'approved', reviewedBy: designer, reviewedAt,
      reason: 'Self approval',
    }), 'M2_APPROVAL_REVIEWER_MUST_DIFFER');
    expectCode(() => reviewM2ApprovalSubmission({
      submission: createSubmission(), decision: 'approved', reviewedBy: client,
      reviewedAt: '2026-08-01T08:00:00.000Z', reason: 'Too early',
    }), 'M2_APPROVAL_REVIEW_BEFORE_SUBMISSION');
  });

  it('permits one human review and commits only an approved submission', () => {
    for (const decision of ['rejected', 'change_requested'] as const) {
      const reviewed = reviewM2ApprovalSubmission({
        submission: createSubmission(), decision, reviewedBy: client, reviewedAt,
        reason: 'Please revise',
      });
      expect(reviewed.review.status).toBe(decision);
      expectCode(() => createApprovedM2Commit({
        ...commitInput(), approvedSubmission: reviewed,
      }), 'M2_COMMIT_NOT_APPROVED');
    }
    expectCode(() => createApprovedM2Commit({
      ...commitInput(), approvedSubmission: createSubmission(),
    }), 'M2_COMMIT_NOT_APPROVED');
    expectCode(() => reviewM2ApprovalSubmission({
      submission: createApprovedSubmission(), decision: 'rejected', reviewedBy: client,
      reviewedAt: '2026-08-04T09:00:00.000Z', reason: 'Second review',
    }), 'M2_APPROVAL_INVALID_TRANSITION');
  });

  it('creates a deterministic deeply immutable snapshot with exact revisions and budget facts', () => {
    const first = createApprovedM2Commit(commitInput());
    const second = createApprovedM2Commit(commitInput());

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      projectId: 'project-1',
      packageId: 'package-1',
      roomId: 'room-1',
      designIntentRevisionId: 'intent-r2',
      chosenVariant: {
        variantId: 'variant-a',
        role: 'preferred',
        layoutDocumentId: 'layout-a',
        layoutVersionId: 'layout-a-v3',
        semanticHash: 'sha256:layout-a-v3',
      },
      approvedSelectionRevisionIds: ['selection-chair-r4'],
      selections: [selection],
      budget: {
        asOf: '2026-08-01T12:00:00.000Z',
        staleAfterDays: 14,
        variantId: 'variant-a',
        amountRub: 240000,
        staleSelectionRevisionIds: [],
        missingPriceSelectionRevisionIds: [],
      },
      submittedBy: designer,
      reviewedBy: client,
      submittedAt,
      reviewedAt,
      submissionReason: 'Please approve the room package',
      reviewReason: 'Approved for production',
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.chosenVariant)).toBe(true);
    expect(Object.isFrozen(first.selections)).toBe(true);
    expect(Object.isFrozen(first.selections[0]!)).toBe(true);
    expect(Object.isFrozen(first.selections[0]!.specification)).toBe(true);
    expect(Object.isFrozen(first.budget)).toBe(true);
  });

  it('rejects exact intent, layout, selection-revision, and chosen-budget drift', () => {
    expectCode(() => createApprovedM2Commit({
      ...commitInput(),
      currentIntent: {
        ...intent,
        revision: { ...intent.revision, revisionId: 'intent-r3', revisionNo: 3 },
      },
    }), 'M2_COMMIT_STALE_INTENT');

    expectCode(() => createApprovedM2Commit({
      ...commitInput(),
      currentIntent: {
        ...intent,
        variants: [{ ...intent.variants[0]!, layoutVersionId: 'layout-a-v4' }],
      },
    }), 'M2_COMMIT_STALE_LAYOUT');

    expectCode(() => createApprovedM2Commit({
      ...commitInput(),
      currentSelections: [{
        ...selection,
        id: 'selection-chair-r5',
        revisionNo: 5,
        replacesRevisionId: 'selection-chair-r4',
      } as SelectionRevision],
    }), 'M2_COMMIT_STALE_SELECTION');

    expectCode(() => createApprovedM2Commit({
      ...commitInput(),
      recalculatedBudget: {
        ...budget,
        variantBudgets: [{ ...budget.variantBudgets[0]!, amountRub: 240001 }],
      },
    }), 'M2_COMMIT_STALE_BUDGET');
  });

  it('rejects invalid selection sets and incomplete chosen-variant pricing', () => {
    expectCode(() => createM2ApprovalSubmission({
      submissionId: 'missing-variant', intent, chosenVariantId: 'variant-missing', selectionRevisionIds,
      selections, budget, submittedBy: designer, submittedAt, reason: 'Bad variant',
    }), 'M2_APPROVAL_VARIANT_NOT_IN_INTENT');

    expectCode(() => createM2ApprovalSubmission({
      submissionId: 'duplicate', intent, chosenVariantId: 'variant-a',
      selectionRevisionIds: ['selection-chair-r4', 'selection-chair-r4'], selections,
      budget, submittedBy: designer, submittedAt, reason: 'Duplicate',
    }), 'M2_APPROVAL_DUPLICATE_SELECTION');

    expectCode(() => createM2ApprovalSubmission({
      submissionId: 'not-approved', intent, chosenVariantId: 'variant-a', selectionRevisionIds,
      selections: [{ ...selection, reviewStatus: 'proposed' } as unknown as SelectionRevision],
      budget, submittedBy: designer, submittedAt, reason: 'Not approved',
    }), 'M2_APPROVAL_SELECTION_NOT_APPROVED');

    const incompleteBudget = {
      ...budget,
      variantBudgets: [{
        ...budget.variantBudgets[0]!,
        pricedSelectionRevisionIds: [],
        missingPriceSelectionRevisionIds: ['selection-chair-r4'],
      }],
    } as DesignIntentBudget;
    expectCode(() => createM2ApprovalSubmission({
      submissionId: 'missing-price', intent, chosenVariantId: 'variant-a', selectionRevisionIds,
      selections, budget: incompleteBudget, submittedBy: designer, submittedAt,
      reason: 'Incomplete pricing',
    }), 'M2_APPROVAL_MISSING_PRICE');
  });

  it('revalidates forged approved submissions at the commit trust boundary', () => {
    const approved = createApprovedSubmission();
    const system = { actorId: 'ai-1', actorType: 'system' } as unknown as HumanActorRef;

    expectCode(() => createApprovedM2Commit({
      ...commitInput(),
      approvedSubmission: { ...approved, submittedBy: system },
    }), 'M2_APPROVAL_HUMAN_REQUIRED');

    expectCode(() => createApprovedM2Commit({
      ...commitInput(),
      approvedSubmission: {
        ...approved,
        review: { ...approved.review, reviewedBy: system },
      },
    }), 'M2_APPROVAL_HUMAN_REQUIRED');

    expectCode(() => createApprovedM2Commit({
      ...commitInput(),
      approvedSubmission: {
        ...approved,
        review: { ...approved.review, reviewedBy: approved.submittedBy },
      },
    }), 'M2_APPROVAL_REVIEWER_MUST_DIFFER');

    expectCode(() => createApprovedM2Commit({
      ...commitInput(),
      approvedSubmission: {
        ...approved,
        review: { ...approved.review, reviewedAt: '2026-08-01T08:00:00.000Z' },
      },
    }), 'M2_APPROVAL_REVIEW_BEFORE_SUBMISSION');

    expectCode(() => createApprovedM2Commit({
      ...commitInput(),
      currentIntent: { ...intent, variants: [] },
    }), 'M2_COMMIT_STALE_LAYOUT');
  });

  it('accepts a semantically identical current selection regardless of object key order', () => {
    const reorderedSelection = {
      replacesRevisionId: selection.replacesRevisionId,
      reason: selection.reason,
      createdBy: selection.createdBy,
      createdAt: selection.createdAt,
      priceObservations: selection.priceObservations,
      evidence: selection.evidence,
      reviewStatus: selection.reviewStatus,
      claimStatus: selection.claimStatus,
      specification: selection.specification,
      decisionRevisionId: selection.decisionRevisionId,
      packageId: selection.packageId,
      areaId: selection.areaId,
      title: selection.title,
      kind: selection.kind,
      revisionNo: selection.revisionNo,
      entityId: selection.entityId,
      projectId: selection.projectId,
      id: selection.id,
    } as SelectionRevision;

    const original = createApprovedM2Commit(commitInput());
    const reconstructed = createApprovedM2Commit({
      ...commitInput(),
      currentSelections: [reorderedSelection],
    });

    expect(reconstructed).toEqual(original);
  });
});
