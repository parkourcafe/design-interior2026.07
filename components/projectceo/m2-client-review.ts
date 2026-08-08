type VariantRole = "preferred" | "value_engineered" | "premium";
type ReviewDecision = "approved" | "change_requested" | "rejected";

export interface M2ClientReviewInput {
  readonly locale: "ru";
  readonly scope: {
    readonly actorRole: "client_approver" | "architect" | "guest" | string;
    readonly actorId: string;
    readonly accessScope: "package" | "project";
    readonly projectId: string;
    readonly packageId: string;
    readonly capabilities: readonly string[];
  };
  readonly reviewPackage: {
    readonly approvalPackageId: string;
    readonly projectId: string;
    readonly packageId: string;
    readonly roomId: string;
    readonly status: string;
    readonly submittedByActorId: string;
    readonly submittedAt: string;
    readonly designIntentRevisionId: string;
    readonly variants: readonly {
      readonly variantId: string;
      readonly role: VariantRole;
      readonly layoutDocumentId: string;
      readonly layoutVersionId: string;
      readonly layoutRevisionId: string;
      readonly semanticHash: string;
      readonly selectionRevisionIds: readonly string[];
      readonly selections: readonly {
        readonly revisionId: string;
        readonly title: string;
        readonly supplierRef: string;
      }[];
      readonly budget: {
        readonly amountRub: number;
        readonly staleSelectionRevisionIds: readonly string[];
        readonly missingPriceSelectionRevisionIds: readonly string[];
      };
    }[];
    readonly budgetAsOf: string;
    readonly staleAfterDays: number;
  };
}

export interface M2ClientReviewModel {
  readonly locale: "ru";
  readonly title: string;
  readonly approvalPackageId: string;
  readonly roomId: string;
  readonly statusLabel: string;
  readonly variants: readonly {
    readonly role: VariantRole;
    readonly label: string;
    readonly layoutVersionId: string;
    readonly layoutRevisionId: string;
    readonly selectionRevisionIds: readonly string[];
    readonly selectionTitles: readonly string[];
    readonly budgetLabel: string;
    readonly warnings: readonly string[];
  }[];
  readonly actions: readonly { readonly decision: ReviewDecision; readonly label: string }[];
}

export class M2ClientReviewError extends Error {
  constructor(public readonly code: string, message = code) {
    super(message);
    this.name = "M2ClientReviewError";
  }
}

const ROLE_ORDER: readonly VariantRole[] = ["preferred", "value_engineered", "premium"];
const ROLE_LABEL: Readonly<Record<VariantRole, string>> = {
  preferred: "Рекомендуемый вариант",
  value_engineered: "Рациональный вариант",
  premium: "Премиальный вариант",
};

function fail(code: string): never {
  throw new M2ClientReviewError(code);
}

function rub(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) fail("M2_CLIENT_REVIEW_BUDGET_INVALID");
  return `${String(value).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₽`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^sha256:[0-9a-f]{64}$/;
const OFFSET_TIMESTAMP = /(?:Z|[+-]\d{2}:\d{2})$/;

function timestamp(value: string): boolean {
  return OFFSET_TIMESTAMP.test(value) && Number.isFinite(Date.parse(value));
}

function identifier(value: string): boolean {
  return value.length >= 1 && value.length <= 160 && value === value.trim();
}

function validateInput(input: M2ClientReviewInput): void {
  const { scope, reviewPackage } = input;
  if (
    input.locale !== "ru"
    || scope.actorRole !== "client_approver"
    || scope.accessScope !== "package"
    || scope.projectId !== reviewPackage.projectId
    || scope.packageId !== reviewPackage.packageId
    || !scope.capabilities.includes("review_selection")
  ) fail("M2_CLIENT_REVIEW_FORBIDDEN");
  if (
    !UUID.test(scope.projectId)
    || !UUID.test(scope.packageId)
    || !UUID.test(scope.actorId)
    || !UUID.test(reviewPackage.submittedByActorId)
    || !timestamp(reviewPackage.submittedAt)
    || !timestamp(reviewPackage.budgetAsOf)
    || !Number.isSafeInteger(reviewPackage.staleAfterDays)
    || reviewPackage.staleAfterDays < 1
    || !identifier(reviewPackage.approvalPackageId)
    || !identifier(reviewPackage.roomId)
    || !identifier(reviewPackage.designIntentRevisionId)
  ) fail("M2_CLIENT_REVIEW_INVALID_INPUT");
  if (reviewPackage.status !== "submitted") fail("M2_CLIENT_REVIEW_NOT_SUBMITTED");

  const byRole = new Map(reviewPackage.variants.map((variant) => [variant.role, variant]));
  if (reviewPackage.variants.length !== 3 || byRole.size !== 3 || ROLE_ORDER.some((role) => !byRole.has(role))) {
    fail("M2_CLIENT_REVIEW_VARIANTS_INVALID");
  }
  const layoutVersions = new Set<string>();
  const layoutRevisions = new Set<string>();
  const layoutDocuments = new Set<string>();
  const variantIds = new Set<string>();
  for (const variant of reviewPackage.variants) {
    if (
      !UUID.test(variant.layoutRevisionId)
      || !HASH.test(variant.semanticHash)
      || !identifier(variant.variantId)
      || !identifier(variant.layoutDocumentId)
      || !identifier(variant.layoutVersionId)
      || variantIds.has(variant.variantId)
      || layoutDocuments.has(variant.layoutDocumentId)
      || layoutVersions.has(variant.layoutVersionId)
      || layoutRevisions.has(variant.layoutRevisionId)
      || !Number.isSafeInteger(variant.budget.amountRub)
      || variant.budget.amountRub < 0
    ) fail("M2_CLIENT_REVIEW_VARIANT_INVALID");
    variantIds.add(variant.variantId);
    layoutDocuments.add(variant.layoutDocumentId);
    layoutVersions.add(variant.layoutVersionId);
    layoutRevisions.add(variant.layoutRevisionId);
    const revisionIds = new Set(variant.selectionRevisionIds);
    const selections = new Map(variant.selections.map((selection) => [selection.revisionId, selection]));
    if (
      revisionIds.size !== variant.selectionRevisionIds.length
      || selections.size !== variant.selections.length
      || variant.selectionRevisionIds.length !== variant.selections.length
      || variant.selectionRevisionIds.some((revisionId) => !selections.has(revisionId))
      || variant.budget.staleSelectionRevisionIds.some((revisionId) => !revisionIds.has(revisionId))
      || variant.budget.missingPriceSelectionRevisionIds.some((revisionId) => !revisionIds.has(revisionId))
    ) fail("M2_CLIENT_REVIEW_SELECTIONS_INVALID");
  }
}

function immutable<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (candidate: unknown): void => {
    if (candidate === null || typeof candidate !== "object" || Object.isFrozen(candidate)) return;
    for (const child of Object.values(candidate as Record<string, unknown>)) freeze(child);
    Object.freeze(candidate);
  };
  freeze(copy);
  return copy;
}

export function buildM2ClientReviewModel(input: M2ClientReviewInput): M2ClientReviewModel {
  validateInput(input);
  const { reviewPackage } = input;
  const byRole = new Map(reviewPackage.variants.map((variant) => [variant.role, variant]));

  const variants = ROLE_ORDER.map((role) => {
    const variant = byRole.get(role)!;
    const selections = new Map(variant.selections.map((selection) => [selection.revisionId, selection]));
    if (
      selections.size !== variant.selections.length
      || variant.selectionRevisionIds.length !== variant.selections.length
      || variant.selectionRevisionIds.some((revisionId) => !selections.has(revisionId))
    ) fail("M2_CLIENT_REVIEW_SELECTIONS_INVALID");
    const title = (revisionId: string): string => selections.get(revisionId)?.title ?? revisionId;
    return {
      role,
      label: ROLE_LABEL[role],
      layoutVersionId: variant.layoutVersionId,
      layoutRevisionId: variant.layoutRevisionId,
      selectionRevisionIds: [...variant.selectionRevisionIds],
      selectionTitles: variant.selectionRevisionIds.map(title),
      budgetLabel: rub(variant.budget.amountRub),
      warnings: [
        ...variant.budget.staleSelectionRevisionIds.map((id) => `Цена устарела: ${title(id)}`),
        ...variant.budget.missingPriceSelectionRevisionIds.map((id) => `Нет актуальной цены: ${title(id)}`),
      ],
    };
  });

  return immutable({
    locale: "ru",
    title: "Согласование дизайн-концепции",
    approvalPackageId: reviewPackage.approvalPackageId,
    roomId: reviewPackage.roomId,
    statusLabel: "Ожидает вашего решения",
    variants,
    actions: [
      { decision: "approved", label: "Согласовать" },
      { decision: "change_requested", label: "Запросить изменения" },
      { decision: "rejected", label: "Отклонить" },
    ],
  });
}

export interface BuildM2ClientReviewActionInput {
  readonly decision: ReviewDecision;
  readonly chosenVariantId: string;
  readonly reason: string;
}

export function buildM2ClientReviewAction(
  input: M2ClientReviewInput,
  action: BuildM2ClientReviewActionInput,
) {
  validateInput(input);
  if (input.scope.actorId === input.reviewPackage.submittedByActorId) {
    fail("M2_CLIENT_REVIEWER_MUST_DIFFER");
  }
  if (!(action.decision === "approved" || action.decision === "change_requested" || action.decision === "rejected")) {
    fail("M2_CLIENT_REVIEW_DECISION_INVALID");
  }
  if (
    action.reason.length < 3
    || action.reason.length > 4000
    || action.reason !== action.reason.trim()
  ) fail("M2_CLIENT_REVIEW_REASON_INVALID");
  const variant = input.reviewPackage.variants.find((candidate) => candidate.variantId === action.chosenVariantId);
  if (!variant) fail("M2_CLIENT_REVIEW_VARIANT_NOT_FOUND");
  if (
    action.decision === "approved"
    && (variant.budget.staleSelectionRevisionIds.length > 0
      || variant.budget.missingPriceSelectionRevisionIds.length > 0)
  ) fail("M2_CLIENT_REVIEW_BUDGET_NOT_CLEAN");
  return immutable({
    kind: "review_m2_design" as const,
    projectId: input.scope.projectId,
    payload: {
      packageId: input.scope.packageId,
      approvalPackageId: input.reviewPackage.approvalPackageId,
      roomId: input.reviewPackage.roomId,
      designIntentRevisionId: input.reviewPackage.designIntentRevisionId,
      chosenVariant: {
        variantId: variant.variantId,
        role: variant.role,
        layoutDocumentId: variant.layoutDocumentId,
        layoutVersionId: variant.layoutVersionId,
        layoutRevisionId: variant.layoutRevisionId,
        semanticHash: variant.semanticHash,
        selectionRevisionIds: [...variant.selectionRevisionIds],
      },
      decision: action.decision,
      reason: action.reason,
    },
  });
}
