import type { RevisionIdentity } from "../decisions";

export type DesignIntentVariantRole =
  | "preferred"
  | "value_engineered"
  | "premium";

export interface DesignIntentVariantInput {
  variantId: string;
  role: DesignIntentVariantRole;
  projectId: string;
  packageId: string;
  roomId: string;
  layoutDocumentId: string;
  layoutVersionId: string;
  semanticHash: string;
}

export interface RoomDesignIntent {
  readonly designIntentId: string;
  readonly projectId: string;
  readonly packageId: string;
  readonly roomId: string;
  readonly revision: RevisionIdentity;
  readonly variants: readonly Readonly<DesignIntentVariantInput>[];
}

export interface ApprovedRoomDesignIntent {
  readonly designIntentId: string;
  readonly projectId: string;
  readonly packageId: string;
  readonly roomId: string;
  readonly revision: RevisionIdentity;
  readonly chosenVariant: Readonly<DesignIntentVariantInput>;
}

export interface CreateRoomDesignIntentInput {
  designIntentId: string;
  projectId: string;
  packageId: string;
  roomId: string;
  revision: RevisionIdentity;
  variants: readonly DesignIntentVariantInput[];
}

export interface PublishRoomDesignIntentInput {
  chosenVariantId: string;
  revision: RevisionIdentity;
}
