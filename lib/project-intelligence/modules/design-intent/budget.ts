import { DecisionContractError } from "../decisions";
import { validateRevisionEntity } from "../decisions";
import type { PriceObservation, SelectionRevision } from "../decisions";
import { compareCodePoints } from "../../ordering";
import type {
  DesignIntentVariantRole,
  RoomDesignIntent,
} from "./contracts";

export interface DesignIntentSelectionBinding {
  readonly variantId: string;
  readonly selectionRevisionIds: readonly string[];
}

export interface CreateDesignIntentBudgetInput {
  readonly intent: RoomDesignIntent;
  readonly selections: readonly SelectionRevision[];
  readonly bindings: readonly DesignIntentSelectionBinding[];
  readonly asOf: string;
  readonly staleAfterDays: number;
}

export interface DesignIntentVariantBudget {
  readonly variantId: string;
  readonly role: DesignIntentVariantRole;
  readonly amountRub: number;
  readonly pricedSelectionRevisionIds: readonly string[];
  readonly staleSelectionRevisionIds: readonly string[];
  readonly missingPriceSelectionRevisionIds: readonly string[];
}

export interface DesignIntentBudget {
  readonly designIntentId: string;
  readonly asOf: string;
  readonly staleAfterDays: number;
  readonly variantBudgets: readonly DesignIntentVariantBudget[];
}

function fail(code: string, message: string): never {
  throw new DecisionContractError(code, message);
}

function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value))
    && /(?:Z|[+-]\d{2}:\d{2})$/.test(value);
}

function immutable<T>(value: T): T {
  const result = structuredClone(value);
  const freeze = (candidate: unknown): void => {
    if (candidate === null || typeof candidate !== "object" || Object.isFrozen(candidate)) return;
    for (const child of Object.values(candidate as Record<string, unknown>)) freeze(child);
    Object.freeze(candidate);
  };
  freeze(result);
  return result;
}

function validateSelection(selection: SelectionRevision): void {
  try {
    validateRevisionEntity(selection);
  } catch {
    fail("DESIGN_BUDGET_INVALID_SELECTION", "A budget selection must be a valid exact SelectionRevision.");
  }
  if (selection.evidence.length === 0) {
    fail("DESIGN_BUDGET_INVALID_SELECTION", "A budget selection requires exact source evidence.");
  }
}

function validateObservation(
  observation: PriceObservation,
  selection: SelectionRevision,
): void {
  const evidence = observation.evidence;
  if (
    !observation.id || observation.id !== observation.id.trim()
    || observation.projectId !== selection.projectId
    || observation.selectionRevisionId !== selection.id
    || !Number.isSafeInteger(observation.amountRub) || observation.amountRub < 0
    || !validTimestamp(observation.observedAt)
    || observation.supplierRef === null
    || !observation.supplierRef
    || observation.supplierRef !== observation.supplierRef.trim()
    || !evidence
    || !evidence.evidenceId || evidence.evidenceId !== evidence.evidenceId.trim()
    || !evidence.sourceId || evidence.sourceId !== evidence.sourceId.trim()
    || !evidence.sourceRevisionId || evidence.sourceRevisionId !== evidence.sourceRevisionId.trim()
  ) {
    fail("DESIGN_BUDGET_INVALID_PRICE_OBSERVATION", "A price observation must have exact scope, evidence, supplier provenance, time and safe RUB amount.");
  }
}

export function createDesignIntentBudget(
  input: CreateDesignIntentBudgetInput,
): DesignIntentBudget {
  if (!validTimestamp(input.asOf)) {
    fail("DESIGN_BUDGET_INVALID_AS_OF", "Budget asOf must be a timestamp with an offset.");
  }
  if (!Number.isSafeInteger(input.staleAfterDays) || input.staleAfterDays < 1) {
    fail("DESIGN_BUDGET_INVALID_STALE_AFTER_DAYS", "staleAfterDays must be a positive safe integer.");
  }

  const variants = new Map(input.intent.variants.map((variant) => [variant.variantId, variant]));
  const selections = new Map<string, SelectionRevision>();
  for (const selection of input.selections) {
    if (
      selection.projectId !== input.intent.projectId
      || selection.packageId !== input.intent.packageId
      || selection.areaId !== input.intent.roomId
    ) {
      fail("DESIGN_BUDGET_SCOPE_MISMATCH", "Budget selections must share the Design Intent project, package and room scope.");
    }
    validateSelection(selection);
    if (selections.has(selection.id)) {
      fail("DESIGN_BUDGET_INVALID_SELECTION", "Selection revision IDs must be unique.");
    }
    for (const price of selection.priceObservations) validateObservation(price, selection);
    selections.set(selection.id, selection);
  }

  const bindings = new Map<string, DesignIntentSelectionBinding>();
  for (const binding of input.bindings) {
    if (!variants.has(binding.variantId)) {
      fail("DESIGN_BUDGET_UNKNOWN_VARIANT", "A binding references an unknown Design Intent variant.");
    }
    if (bindings.has(binding.variantId)) {
      fail("DESIGN_BUDGET_DUPLICATE_BINDING", "Each variant may have only one budget binding.");
    }
    const ids = new Set<string>();
    for (const id of binding.selectionRevisionIds) {
      if (ids.has(id)) fail("DESIGN_BUDGET_DUPLICATE_SELECTION", "A binding cannot contain the same selection twice.");
      ids.add(id);
      if (!selections.has(id)) fail("DESIGN_BUDGET_UNKNOWN_SELECTION", "A binding references an unknown selection revision.");
    }
    bindings.set(binding.variantId, binding);
  }
  if (input.intent.variants.some((variant) => !bindings.has(variant.variantId))) {
    fail("DESIGN_BUDGET_MISSING_VARIANT_BINDING", "Every Design Intent variant requires a budget binding.");
  }

  const asOfMs = Date.parse(input.asOf);
  const staleMs = input.staleAfterDays * 86_400_000;
  const variantBudgets = input.intent.variants.map((variant): DesignIntentVariantBudget => {
    const binding = bindings.get(variant.variantId)!;
    let amountRub = 0;
    const pricedSelectionRevisionIds: string[] = [];
    const staleSelectionRevisionIds: string[] = [];
    const missingPriceSelectionRevisionIds: string[] = [];

    for (const selectionId of binding.selectionRevisionIds) {
      const selection = selections.get(selectionId)!;
      const price = selection.priceObservations
        .filter((candidate) => Date.parse(candidate.observedAt) <= asOfMs)
        .sort((left, right) => {
          const timeDifference = Date.parse(right.observedAt) - Date.parse(left.observedAt);
          return timeDifference || compareCodePoints(left.id, right.id);
        })[0];
      if (!price) {
        missingPriceSelectionRevisionIds.push(selectionId);
        continue;
      }
      if (!Number.isSafeInteger(amountRub + price.amountRub)) {
        fail("DESIGN_BUDGET_UNSAFE_TOTAL", "The variant budget exceeds safe integer RUB precision.");
      }
      amountRub += price.amountRub;
      pricedSelectionRevisionIds.push(selectionId);
      if (asOfMs - Date.parse(price.observedAt) > staleMs) staleSelectionRevisionIds.push(selectionId);
    }

    return { variantId: variant.variantId, role: variant.role, amountRub, pricedSelectionRevisionIds, staleSelectionRevisionIds, missingPriceSelectionRevisionIds };
  });

  return immutable({
    designIntentId: input.intent.designIntentId,
    asOf: input.asOf,
    staleAfterDays: input.staleAfterDays,
    variantBudgets,
  });
}
