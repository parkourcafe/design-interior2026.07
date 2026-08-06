import { DecisionContractError } from "../decisions";
import type {
  ApprovedRoomDesignIntent,
  CreateRoomDesignIntentInput,
  DesignIntentVariantInput,
  DesignIntentVariantRole,
  PublishRoomDesignIntentInput,
  RoomDesignIntent,
} from "./contracts";

const REQUIRED_VARIANT_ROLES: readonly DesignIntentVariantRole[] = [
  "preferred",
  "value_engineered",
  "premium",
];

function immutable<T>(value: T): T {
  const cloned = structuredClone(value);

  const freeze = (candidate: unknown): void => {
    if (
      candidate === null
      || typeof candidate !== "object"
      || Object.isFrozen(candidate)
    ) {
      return;
    }

    for (const child of Object.values(candidate as Record<string, unknown>)) {
      freeze(child);
    }
    Object.freeze(candidate);
  };

  freeze(cloned);
  return cloned;
}

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

function requireRevisionReason(reason: string): void {
  if (isBlank(reason)) {
    throw new DecisionContractError(
      "DESIGN_INTENT_REVISION_REASON_REQUIRED",
      "A Design Intent revision requires a reason.",
    );
  }
}

function validateVariantScope(
  variant: DesignIntentVariantInput,
  input: CreateRoomDesignIntentInput,
): void {
  if (
    variant.projectId !== input.projectId
    || variant.packageId !== input.packageId
    || variant.roomId !== input.roomId
  ) {
    throw new DecisionContractError(
      "DESIGN_INTENT_VARIANT_SCOPE_MISMATCH",
      "Every Design Intent variant must belong to the same project, package and room.",
    );
  }
}

function validateExactLayoutRevision(variant: DesignIntentVariantInput): void {
  if (isBlank(variant.layoutVersionId) || isBlank(variant.semanticHash)) {
    throw new DecisionContractError(
      "DESIGN_INTENT_EXACT_LAYOUT_REVISION_REQUIRED",
      "Every Design Intent variant must identify an exact immutable layout revision.",
    );
  }
}

function validateControlledRoles(
  variants: readonly DesignIntentVariantInput[],
): void {
  const roles = new Set<DesignIntentVariantRole>();

  for (const variant of variants) {
    if (roles.has(variant.role)) {
      throw new DecisionContractError(
        "DESIGN_INTENT_DUPLICATE_VARIANT_ROLE",
        "A Design Intent cannot contain duplicate controlled variant roles.",
      );
    }
    roles.add(variant.role);
  }

  if (
    variants.length !== REQUIRED_VARIANT_ROLES.length
    || REQUIRED_VARIANT_ROLES.some((role) => !roles.has(role))
  ) {
    throw new DecisionContractError(
      "DESIGN_INTENT_MISSING_VARIANT_ROLE",
      "A Design Intent requires preferred, value-engineered and premium variants.",
    );
  }
}

export function createRoomDesignIntent(
  input: CreateRoomDesignIntentInput,
): RoomDesignIntent {
  if (
    isBlank(input.designIntentId)
    || isBlank(input.projectId)
    || isBlank(input.packageId)
    || isBlank(input.roomId)
  ) {
    throw new DecisionContractError(
      "DESIGN_INTENT_INVALID_ID",
      "Design Intent, project, package and room IDs must be non-blank.",
    );
  }

  requireRevisionReason(input.revision.reason);

  for (const variant of input.variants) {
    validateVariantScope(variant, input);
    validateExactLayoutRevision(variant);
  }
  validateControlledRoles(input.variants);

  return immutable({
    designIntentId: input.designIntentId,
    projectId: input.projectId,
    packageId: input.packageId,
    roomId: input.roomId,
    revision: input.revision,
    variants: input.variants,
  });
}

export function publishRoomDesignIntent(
  intent: RoomDesignIntent,
  input: PublishRoomDesignIntentInput,
): ApprovedRoomDesignIntent {
  requireRevisionReason(input.revision.reason);

  const chosenVariant = intent.variants.find(
    (variant) => variant.variantId === input.chosenVariantId,
  );
  if (!chosenVariant) {
    throw new DecisionContractError(
      "DESIGN_INTENT_CHOSEN_VARIANT_NOT_FOUND",
      "The chosen variant is not a member of this Design Intent.",
    );
  }

  return immutable({
    designIntentId: intent.designIntentId,
    projectId: intent.projectId,
    packageId: intent.packageId,
    roomId: intent.roomId,
    revision: input.revision,
    chosenVariant,
  });
}
