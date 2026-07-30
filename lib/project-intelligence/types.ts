export const PROJECT_GRAPH_NODE_KINDS = [
  "area",
  "source",
  "requirement",
  "assumption",
  "decision",
  "risk",
  "deliverable",
  "item",
  "approval",
] as const;

export type ProjectGraphNodeKind = (typeof PROJECT_GRAPH_NODE_KINDS)[number];

export const REVISION_CLAIM_STATUSES = ["extracted", "interpreted", "unknown"] as const;
export type RevisionClaimStatus = (typeof REVISION_CLAIM_STATUSES)[number];

export const HUMAN_CLAIM_STATUSES = ["human_confirmed", "human_rejected"] as const;
export type HumanClaimStatus = (typeof HUMAN_CLAIM_STATUSES)[number];

export const CLAIM_STATUSES = [...REVISION_CLAIM_STATUSES, ...HUMAN_CLAIM_STATUSES] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CONTENT_ORIGINS = ["human", "ai", "import", "system"] as const;
export type ContentOrigin = (typeof CONTENT_ORIGINS)[number];

export const PROJECT_GRAPH_RELATIONS = [
  "depends_on",
  "derived_from",
  "specified_by",
  "satisfies",
  "applies_to",
  "contains",
  "conflicts_with",
  "references",
] as const;

export type ProjectGraphRelation = (typeof PROJECT_GRAPH_RELATIONS)[number];

export const PROJECT_SOURCE_KINDS = [
  "pdf",
  "transcript",
  "audio",
  "image",
  "spreadsheet",
  "email",
  "plain_text",
  "questionnaire",
] as const;

export type ProjectSourceKind = (typeof PROJECT_SOURCE_KINDS)[number];

export const SOURCE_LOCATOR_KINDS = [
  "pdf",
  "transcript",
  "image",
  "spreadsheet",
  "email",
  "plain_text",
] as const;

export type SourceLocatorKind = (typeof SOURCE_LOCATOR_KINDS)[number];
export type BoundingBox = readonly [number, number, number, number];

export interface PdfLocator {
  kind: "pdf";
  page: number;
  bbox?: BoundingBox;
}

export interface TranscriptLocator {
  kind: "transcript";
  startMs: number;
  endMs: number;
  speaker?: string;
}

export interface ImageLocator {
  kind: "image";
  coordinateSystem: "pixel" | "normalized";
  bbox: BoundingBox;
}

export interface SpreadsheetLocator {
  kind: "spreadsheet";
  sheet: string;
  cellRange: string;
}

export interface EmailLocator {
  kind: "email";
  messageId: string;
  paragraph?: number;
  part?: string;
}

export interface PlainTextLocator {
  kind: "plain_text";
  startCharacter: number;
  endCharacter: number;
}

export type SourceLocator =
  | PdfLocator
  | TranscriptLocator
  | ImageLocator
  | SpreadsheetLocator
  | EmailLocator
  | PlainTextLocator;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ProjectSource {
  id: string;
  projectId: string;
  kind: ProjectSourceKind;
  checksum: string;
}

export interface SourceFragment {
  id: string;
  projectId: string;
  sourceId: string;
  locator: SourceLocator;
}

export interface ProjectGraphNode {
  id: string;
  projectId: string;
  kind: ProjectGraphNodeKind;
  stableKey: string;
  currentRevisionId: string;
}

export interface GraphNodeRevision {
  id: string;
  nodeId: string;
  projectId: string;
  title: string;
  payload: JsonValue;
  origin: ContentOrigin;
  claimStatus: RevisionClaimStatus;
  unknownReason?: string;
  replacesRevisionId?: string;
}

export const HUMAN_REVIEW_DECISIONS = ["confirmed", "rejected"] as const;
export type HumanReviewDecision = (typeof HUMAN_REVIEW_DECISIONS)[number];

export interface HumanReviewActor {
  id: string;
  type: "human";
}

export interface HumanReview {
  id: string;
  projectId: string;
  targetRevisionId: string;
  decision: HumanReviewDecision;
  actor: HumanReviewActor;
  reviewedAt: string;
}

export interface ReviewActorContext {
  actorId: string;
  actorType: "human" | "ai" | "system";
}

export type ReviewInitiator =
  | { kind: "human_action"; actor: ReviewActorContext }
  | { kind: "system_proposal"; actor: ReviewActorContext };

export interface ReviewRevisionInput {
  snapshot: ProjectGraphSnapshot;
  reviewId: string;
  targetRevisionId: string;
  expectedRevisionId: string;
  decision: HumanReviewDecision;
  initiator: ReviewInitiator;
  reviewedAt: string;
}

export interface ReviewTransition {
  targetRevision: GraphNodeRevision;
  review: HumanReview;
  effectiveClaimStatus: HumanClaimStatus;
}

export interface ProjectGraphEdge {
  id: string;
  projectId: string;
  fromNodeId: string;
  toNodeId: string;
  relation: ProjectGraphRelation;
}

export interface EvidenceLink {
  id: string;
  projectId: string;
  nodeRevisionId: string;
  sourceFragmentId: string;
}

export interface ProjectGraphSnapshot {
  projectId: string;
  versionId: string;
  sources: ProjectSource[];
  sourceFragments: SourceFragment[];
  nodes: ProjectGraphNode[];
  revisions: GraphNodeRevision[];
  reviews: HumanReview[];
  evidenceLinks: EvidenceLink[];
  edges: ProjectGraphEdge[];
}

export interface ImpactPathStep {
  edgeId: string;
  relation: ProjectGraphRelation;
  fromNodeId: string;
  toNodeId: string;
}

export interface ChangeImpact {
  changedNodeId: string;
  impactedNodeId: string;
  distance: number;
  nodePath: string[];
  edgePath: ImpactPathStep[];
}

export interface VersionNodeSnapshot {
  nodeId: string;
  revisionId: string;
  payload: JsonValue;
}

export interface ProjectVersionSnapshot {
  projectId: string;
  versionId: string;
  nodes: VersionNodeSnapshot[];
}

export type NodeVersionChangeType = "added" | "removed" | "changed" | "revision_transition";

export interface NodeVersionChange {
  nodeId: string;
  changeType: NodeVersionChangeType;
  fromRevisionId: string | null;
  toRevisionId: string | null;
  changedPaths: string[];
  impactRelevant: boolean;
}
