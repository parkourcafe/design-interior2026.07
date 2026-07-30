import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ContentOrigin,
  GraphNodeRevision,
  HumanReview,
  JsonValue,
  ProjectGraphEdge,
  ProjectGraphNodeKind,
  ProjectGraphRelation,
  ProjectGraphSnapshot,
  ProjectSourceKind,
  ProjectVersionSnapshot,
  RevisionClaimStatus,
  SourceLocator,
} from "../../../../index";
import type {
  ApplicationExecutionContext,
  ChangeContext,
  ChangeHandoffIdFactory,
  HandoffPolicyInput,
  PublishedProjectVersion,
} from "../../types";

const FIXTURE_ROOT = join(process.cwd(), "fixtures/project-intelligence/kitchen-worktop");

export function fixture<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, relativePath), "utf8")) as T;
}

interface FixtureSourceFile {
  sources: Array<{
    id: string;
    projectId: string;
    sourceKind: ProjectSourceKind;
    checksum: string;
  }>;
}

interface FixtureFragmentFile {
  fragments: Array<{
    id: string;
    projectId: string;
    sourceId: string;
    fragmentKind: "pdf_region" | "structured_field" | "transcript_span";
    locator: JsonValue;
  }>;
}

interface FixtureRevision {
  id: string;
  nodeId: string;
  projectId: string;
  title: string;
  payload: JsonValue;
  contentOrigin: ContentOrigin;
  claimStatus: RevisionClaimStatus | "human_confirmed" | "human_rejected";
  unknownReason?: string | null;
  replacesRevisionId?: string | null;
}

export interface FixtureGraph {
  projectId: string;
  version: {
    id: string;
    versionNo: number;
    baseVersionId: string | null;
    status: "published";
    label: string;
    nodeRevisions: Array<{ nodeId: string; revisionId: string }>;
  };
  changeSet?: {
    id: string;
    fromVersionId: string;
    toVersionId: string;
    reasonCode: string;
  };
  nodes: Array<{
    id: string;
    projectId: string;
    kind: ProjectGraphNodeKind;
    stableKey: string;
    currentRevisionId: string;
  }>;
  revisions: FixtureRevision[];
  edges: Array<{
    id: string;
    projectId: string;
    fromNodeId: string;
    toNodeId: string;
    relation: ProjectGraphRelation;
    validFromVersionId: string;
    validToVersionId: string | null;
  }>;
  evidenceLinks: Array<{
    id: string;
    projectId: string;
    nodeRevisionId: string;
    sourceFragmentId: string;
  }>;
  reviews: Array<{
    id: string;
    projectId: string;
    action: "confirm" | "reject" | "edit";
    targetRevisionId: string;
    resultingRevisionId: string;
    actor: { actorId: string; actorType: "human"; role: string };
    occurredAt: string;
  }>;
}

export const graphV1Fixture = fixture<FixtureGraph>("graph-v1.json");
export const graphV2Fixture = fixture<FixtureGraph>("graph-v2.json");
const sourceFile = fixture<FixtureSourceFile>("sources.json");
const fragmentFile = fixture<FixtureFragmentFile>("fragments.json");

function mapLocator(fragment: FixtureFragmentFile["fragments"][number]): SourceLocator {
  if (fragment.fragmentKind === "pdf_region") {
    const locator = fragment.locator as unknown as { page: number; bbox: [number, number, number, number] };
    return { kind: "pdf", page: locator.page, bbox: locator.bbox };
  }
  if (fragment.fragmentKind === "transcript_span") {
    const locator = fragment.locator as unknown as {
      startMs: number;
      endMs: number;
      speaker: string;
    };
    return { kind: "transcript", ...locator };
  }
  return { kind: "plain_text", startCharacter: 61, endCharacter: 89 };
}

function baseClaimStatus(revision: FixtureRevision): RevisionClaimStatus {
  if (
    revision.claimStatus === "extracted"
    || revision.claimStatus === "interpreted"
    || revision.claimStatus === "unknown"
  ) return revision.claimStatus;
  return revision.contentOrigin === "ai" ? "extracted" : "interpreted";
}

function activeAtVersion(edge: FixtureGraph["edges"][number], graph: FixtureGraph): boolean {
  const ordinal = (versionId: string): number => Number(/-v(\d+)$/.exec(versionId)?.[1]);
  const current = graph.version.versionNo;
  return ordinal(edge.validFromVersionId) <= current
    && (edge.validToVersionId === null || current < ordinal(edge.validToVersionId));
}

function mapReviews(graph: FixtureGraph): HumanReview[] {
  const currentRevisionIds = new Set(graph.nodes.map(({ currentRevisionId }) => currentRevisionId));
  return graph.revisions
    .filter((revision) => currentRevisionIds.has(revision.id))
    .filter(({ claimStatus }) => claimStatus === "human_confirmed" || claimStatus === "human_rejected")
    .map((revision) => {
      const source = graph.reviews.find(
        (review) => review.resultingRevisionId === revision.id || review.targetRevisionId === revision.id,
      );
      if (!source) throw new Error(`Missing fixture review for ${revision.id}.`);
      return {
        id: source.id,
        projectId: graph.projectId,
        targetRevisionId: revision.id,
        decision: revision.claimStatus === "human_confirmed" ? "confirmed" : "rejected",
        actor: { id: source.actor.actorId, type: "human" },
        reviewedAt: source.occurredAt,
      };
    });
}

export function mapGraph(graph: FixtureGraph): ProjectGraphSnapshot {
  const revisions: GraphNodeRevision[] = graph.revisions.map((revision) => ({
    id: revision.id,
    nodeId: revision.nodeId,
    projectId: revision.projectId,
    title: revision.title,
    payload: revision.payload,
    origin: revision.contentOrigin,
    claimStatus: baseClaimStatus(revision),
    ...(revision.unknownReason ? { unknownReason: revision.unknownReason } : {}),
    ...(revision.replacesRevisionId ? { replacesRevisionId: revision.replacesRevisionId } : {}),
  }));
  const edges: ProjectGraphEdge[] = graph.edges
    .filter((edge) => activeAtVersion(edge, graph))
    .map(({ id, projectId, fromNodeId, toNodeId, relation }) => ({
      id,
      projectId,
      fromNodeId,
      toNodeId,
      relation,
    }));

  return {
    projectId: graph.projectId,
    versionId: graph.version.id,
    sources: sourceFile.sources.map(({ id, projectId, sourceKind: kind, checksum }) => ({
      id,
      projectId,
      kind,
      checksum,
    })),
    sourceFragments: fragmentFile.fragments.map((fragment) => ({
      id: fragment.id,
      projectId: fragment.projectId,
      sourceId: fragment.sourceId,
      locator: mapLocator(fragment),
    })),
    nodes: graph.nodes.map((node) => ({ ...node })),
    revisions,
    reviews: mapReviews(graph),
    evidenceLinks: graph.evidenceLinks.map((link) => ({ ...link })),
    edges,
  };
}

export function mapVersion(graph: FixtureGraph): ProjectVersionSnapshot {
  return {
    projectId: graph.projectId,
    versionId: graph.version.id,
    nodes: graph.version.nodeRevisions.map(({ nodeId, revisionId }) => {
      const revision = graph.revisions.find(({ id }) => id === revisionId);
      if (!revision) throw new Error(`Missing fixture revision ${revisionId}.`);
      return { nodeId, revisionId, payload: revision.payload };
    }),
  };
}

export const graphV1 = mapGraph(graphV1Fixture);
export const graphV2 = mapGraph(graphV2Fixture);
export const versionV1 = mapVersion(graphV1Fixture);
export const versionV2 = mapVersion(graphV2Fixture);

export const changeContext: ChangeContext = {
  projectId: graphV2Fixture.projectId,
  fromVersionId: graphV1Fixture.version.id,
  toVersionId: graphV2Fixture.version.id,
  changeSetId: graphV2Fixture.changeSet!.id,
  reasonCode: graphV2Fixture.changeSet!.reasonCode,
};

export const calculateExecution: ApplicationExecutionContext = {
  actorId: "actor-impact-worker",
  actorType: "system",
  organizationId: "organization-synthetic-001",
  projectId: graphV2Fixture.projectId,
  capabilities: ["calculate_change_impact"],
  serverTime: "2026-07-16T01:03:00.000Z",
  requestId: "request-impact-001",
};

export const reviewExecution: ApplicationExecutionContext = {
  actorId: "actor-designer-reviewer",
  actorType: "human",
  organizationId: "organization-synthetic-001",
  projectId: graphV2Fixture.projectId,
  capabilities: ["review_change_impact"],
  serverTime: "2026-07-16T01:06:00.000Z",
  requestId: "request-review-001",
};

export const buildExecution: ApplicationExecutionContext = {
  actorId: "actor-export-worker",
  actorType: "system",
  organizationId: "organization-synthetic-001",
  projectId: graphV2Fixture.projectId,
  capabilities: ["build_logical_handoff"],
  serverTime: "2026-07-16T01:15:00.000Z",
  requestId: "request-handoff-001",
};

export const targetPublishedVersion: PublishedProjectVersion = {
  status: "published",
  snapshot: versionV2,
  versionNo: graphV2Fixture.version.versionNo,
  baseVersionId: graphV2Fixture.version.baseVersionId,
  label: graphV2Fixture.version.label,
};

export const handoffPolicy: HandoffPolicyInput = {
  canonicalMetadata: { currency: "USD", lengthUnit: "m", areaUnit: "m2" },
  displayMetadata: { locale: "en-US", unitSystem: "us_customary", currencyDisplay: "symbol" },
  sourceReferenceProjections: [
    {
      evidenceLinkId: "evidence-decision-transcript-r1",
      referenceId: "source-reference-transcript-decision",
      locator: fragmentFile.fragments.find(({ id }) => id === "fragment-transcript-decision")!.locator,
    },
    {
      evidenceLinkId: "evidence-item-plan-r1",
      referenceId: "source-reference-plan-kitchen",
      locator: fragmentFile.fragments.find(({ id }) => id === "fragment-plan-kitchen")!.locator,
    },
    {
      evidenceLinkId: "evidence-requirement-questionnaire-r1",
      referenceId: "source-reference-questionnaire-requirement",
      locator: fragmentFile.fragments.find(({ id }) => id === "fragment-questionnaire-requirement")!.locator,
    },
  ],
};

export const fixtureIdFactory: ChangeHandoffIdFactory = {
  createId({ kind, semanticIdentity, hints }) {
    switch (kind) {
      case "impact_run": return "impact-run-kitchen-v1-v2-001";
      case "impact": return `impact-${hints.impactedNodeId}`;
      case "impact_review": return `review-${hints.impactId}-${hints.disposition}`;
      case "handoff_artifact": return hints.idempotencyKey === "build-handoff-001"
        ? "export-kitchen-v2-render-001"
        : `export-${semanticIdentity.slice(-12)}`;
      case "source_reference": return `source-reference-${hints.fragmentId}`;
    }
  },
};
