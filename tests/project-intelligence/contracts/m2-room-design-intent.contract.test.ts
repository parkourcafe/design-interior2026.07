import { describe, expect, it } from "vitest";
import {
  DecisionContractError,
  type HumanActorRef,
  type RevisionIdentity,
} from "@/lib/project-intelligence/modules/decisions";
import {
  createRoomDesignIntent,
  publishRoomDesignIntent,
  type DesignIntentVariantInput,
} from "@/lib/project-intelligence/modules/design-intent";

const actor: HumanActorRef = {
  actorId: "designer-1",
  actorType: "human",
};

const revision: RevisionIdentity = {
  revisionId: "intent-rev-1",
  revisionNo: 1,
  createdAt: "2026-08-06T10:00:00.000Z",
  createdBy: actor,
  reason: "Initial room design intent",
};

const variant = (
  role: DesignIntentVariantInput["role"],
  overrides: Partial<DesignIntentVariantInput> = {},
): DesignIntentVariantInput => ({
  variantId: `variant-${role}`,
  role,
  projectId: "project-1",
  packageId: "package-1",
  roomId: "room-kitchen",
  layoutDocumentId: "layout-document-1",
  layoutVersionId: `layout-version-${role}`,
  semanticHash: `sha256:${role}`,
  ...overrides,
});

const validVariants = (): DesignIntentVariantInput[] => [
  variant("preferred"),
  variant("value_engineered"),
  variant("premium"),
];

const createValidIntent = () =>
  createRoomDesignIntent({
    designIntentId: "intent-1",
    projectId: "project-1",
    packageId: "package-1",
    roomId: "room-kitchen",
    revision,
    variants: validVariants(),
  });

const expectCode = (operation: () => unknown, code: string) => {
  try {
    operation();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(DecisionContractError);
    expect((error as DecisionContractError).code).toBe(code);
  }
};

describe("M2 room-scoped Design Intent contract", () => {
  it("creates exactly three controlled variants and publishes an immutable snapshot of the chosen exact layout revision", () => {
    const inputs = validVariants();
    const intent = createRoomDesignIntent({
      designIntentId: "intent-1",
      projectId: "project-1",
      packageId: "package-1",
      roomId: "room-kitchen",
      revision,
      variants: inputs,
    });

    const approved = publishRoomDesignIntent(intent, {
      chosenVariantId: "variant-preferred",
      revision: {
        revisionId: "approval-rev-1",
        revisionNo: 2,
        createdAt: "2026-08-06T11:00:00.000Z",
        createdBy: actor,
        reason: "Client selected the preferred scheme",
      },
    });

    expect(intent.variants.map(({ role }) => role).sort()).toEqual([
      "preferred",
      "premium",
      "value_engineered",
    ]);
    expect(approved.chosenVariant).toMatchObject({
      variantId: "variant-preferred",
      role: "preferred",
      projectId: "project-1",
      packageId: "package-1",
      roomId: "room-kitchen",
      layoutDocumentId: "layout-document-1",
      layoutVersionId: "layout-version-preferred",
      semanticHash: "sha256:preferred",
    });

    inputs[0]!.layoutVersionId = "mutated-draft-version";
    inputs[0]!.semanticHash = "mutated-draft-hash";
    expect(approved.chosenVariant.layoutVersionId).toBe("layout-version-preferred");
    expect(approved.chosenVariant.semanticHash).toBe("sha256:preferred");
    expect(Object.isFrozen(approved)).toBe(true);
    expect(Object.isFrozen(approved.chosenVariant)).toBe(true);
  });

  it.each([
    ["project", { projectId: "project-2" }, "DESIGN_INTENT_VARIANT_SCOPE_MISMATCH"],
    ["package", { packageId: "package-2" }, "DESIGN_INTENT_VARIANT_SCOPE_MISMATCH"],
    ["room", { roomId: "room-bedroom" }, "DESIGN_INTENT_VARIANT_SCOPE_MISMATCH"],
  ] as const)("rejects a variant from another %s", (_scope, overrides, code) => {
    const variants = validVariants();
    variants[0] = variant("preferred", overrides);

    expectCode(
      () =>
        createRoomDesignIntent({
          designIntentId: "intent-1",
          projectId: "project-1",
          packageId: "package-1",
          roomId: "room-kitchen",
          revision,
          variants,
        }),
      code,
    );
  });

  it("rejects duplicate controlled roles", () => {
    expectCode(
      () =>
        createRoomDesignIntent({
          designIntentId: "intent-1",
          projectId: "project-1",
          packageId: "package-1",
          roomId: "room-kitchen",
          revision,
          variants: [
            variant("preferred"),
            variant("preferred", { variantId: "variant-preferred-2" }),
            variant("premium"),
          ],
        }),
      "DESIGN_INTENT_DUPLICATE_VARIANT_ROLE",
    );
  });

  it("rejects an incomplete role set", () => {
    expectCode(
      () =>
        createRoomDesignIntent({
          designIntentId: "intent-1",
          projectId: "project-1",
          packageId: "package-1",
          roomId: "room-kitchen",
          revision,
          variants: [variant("preferred"), variant("premium")],
        }),
      "DESIGN_INTENT_MISSING_VARIANT_ROLE",
    );
  });

  it.each([
    ["layoutVersionId", { layoutVersionId: "   " }],
    ["semanticHash", { semanticHash: "" }],
  ] as const)("rejects a mutable layout reference without %s", (_field, overrides) => {
    const variants = validVariants();
    variants[1] = variant("value_engineered", overrides);

    expectCode(
      () =>
        createRoomDesignIntent({
          designIntentId: "intent-1",
          projectId: "project-1",
          packageId: "package-1",
          roomId: "room-kitchen",
          revision,
          variants,
        }),
      "DESIGN_INTENT_EXACT_LAYOUT_REVISION_REQUIRED",
    );
  });

  it("rejects publishing a chosen variant that is not a member of the aggregate", () => {
    expectCode(
      () =>
        publishRoomDesignIntent(createValidIntent(), {
          chosenVariantId: "variant-from-another-intent",
          revision: { ...revision, revisionId: "approval-rev-1", revisionNo: 2 },
        }),
      "DESIGN_INTENT_CHOSEN_VARIANT_NOT_FOUND",
    );
  });

  it.each([
    ["design intent ID", { designIntentId: "   " }],
    ["project ID", { projectId: "" }],
    ["package ID", { packageId: "\t" }],
    ["room ID", { roomId: "  " }],
  ] as const)("rejects a blank %s", (_label, overrides) => {
    expectCode(
      () =>
        createRoomDesignIntent({
          designIntentId: "intent-1",
          projectId: "project-1",
          packageId: "package-1",
          roomId: "room-kitchen",
          revision,
          variants: validVariants(),
          ...overrides,
        }),
      "DESIGN_INTENT_INVALID_ID",
    );
  });

  it("rejects a blank revision reason when creating or publishing", () => {
    expectCode(
      () =>
        createRoomDesignIntent({
          designIntentId: "intent-1",
          projectId: "project-1",
          packageId: "package-1",
          roomId: "room-kitchen",
          revision: { ...revision, reason: "   " },
          variants: validVariants(),
        }),
      "DESIGN_INTENT_REVISION_REASON_REQUIRED",
    );

    expectCode(
      () =>
        publishRoomDesignIntent(createValidIntent(), {
          chosenVariantId: "variant-preferred",
          revision: {
            ...revision,
            revisionId: "approval-rev-1",
            revisionNo: 2,
            reason: "\n",
          },
        }),
      "DESIGN_INTENT_REVISION_REASON_REQUIRED",
    );
  });
});
