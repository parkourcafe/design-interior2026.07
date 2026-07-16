import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function normalizePath(path) {
  return path.split(sep).join("/");
}

function walkJson(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = join(directory, entry.name);
      return entry.isDirectory() ? walkJson(absolute) : [absolute];
    })
    .filter((path) => path.endsWith(".json"));
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(join(root, path), "utf8"));
  } catch (error) {
    failures.push(`${path}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sameJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function uniqueById(items, label) {
  const seen = new Set();
  for (const item of items) {
    assert(typeof item.id === "string" && item.id.length > 0, `${label}: entity is missing id`);
    assert(!seen.has(item.id), `${label}: duplicate id ${item.id}`);
    seen.add(item.id);
  }
  return new Map(items.map((item) => [item.id, item]));
}

function assertSortedById(items, label) {
  const ids = items.map((item) => item.id);
  assert(sameJson(ids, [...ids].sort()), `${label}: ids are not in deterministic lexical order`);
}

function pointerSegment(value) {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function childPath(path, segment) {
  return `${path}/${pointerSegment(segment)}`;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function diffJsonPaths(from, to, path = "") {
  if (Object.is(from, to)) return [];
  if (Array.isArray(from) && Array.isArray(to)) {
    const paths = [];
    const length = Math.max(from.length, to.length);
    for (let index = 0; index < length; index += 1) {
      const next = childPath(path, String(index));
      if (index >= from.length || index >= to.length) paths.push(next);
      else paths.push(...diffJsonPaths(from[index], to[index], next));
    }
    return paths;
  }
  if (isPlainObject(from) && isPlainObject(to)) {
    const paths = [];
    const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])].sort();
    for (const key of keys) {
      const next = childPath(path, key);
      if (!(key in from) || !(key in to)) paths.push(next);
      else paths.push(...diffJsonPaths(from[key], to[key], next));
    }
    return paths;
  }
  return [path];
}

function versionSnapshot(graph) {
  const revisions = new Map(graph.revisions.map((revision) => [revision.id, revision]));
  return new Map(graph.version.nodeRevisions.map(({ nodeId, revisionId }) => {
    const revision = revisions.get(revisionId);
    return [nodeId, { nodeId, revisionId, payload: revision?.payload }];
  }));
}

function diffVersions(fromGraph, toGraph) {
  const from = versionSnapshot(fromGraph);
  const to = versionSnapshot(toGraph);
  const nodeIds = [...new Set([...from.keys(), ...to.keys()])].sort();
  const changes = [];
  for (const nodeId of nodeIds) {
    const before = from.get(nodeId);
    const after = to.get(nodeId);
    if (!before && after) {
      changes.push({ nodeId, changeType: "added", fromRevisionId: null, toRevisionId: after.revisionId, changedPaths: [""] });
      continue;
    }
    if (before && !after) {
      changes.push({ nodeId, changeType: "removed", fromRevisionId: before.revisionId, toRevisionId: null, changedPaths: [""] });
      continue;
    }
    if (!before || !after) continue;
    const changedPaths = diffJsonPaths(before.payload, after.payload);
    if (changedPaths.length > 0) {
      changes.push({
        nodeId,
        changeType: "changed",
        fromRevisionId: before.revisionId,
        toRevisionId: after.revisionId,
        changedPaths,
      });
    }
  }
  return changes;
}

function calculateImpact(nodes, edges, changedNodeIds, propagatingRelations) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map();
  for (const edge of edges) {
    if (!propagatingRelations.has(edge.relation)) continue;
    const list = incoming.get(edge.toNodeId) ?? [];
    list.push(edge);
    incoming.set(edge.toNodeId, list);
  }
  for (const list of incoming.values()) list.sort((left, right) => left.id.localeCompare(right.id));

  const impacts = [];
  for (const changedNodeId of [...new Set(changedNodeIds)].sort()) {
    assert(nodeMap.has(changedNodeId), `impact: changed node ${changedNodeId} does not exist`);
    const queue = [{ nodeId: changedNodeId, nodePath: [changedNodeId], edgePath: [] }];
    const visited = new Set([changedNodeId]);
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      for (const edge of incoming.get(current.nodeId) ?? []) {
        if (visited.has(edge.fromNodeId)) continue;
        visited.add(edge.fromNodeId);
        const nodePath = [...current.nodePath, edge.fromNodeId];
        const edgePath = [...current.edgePath, {
          edgeId: edge.id,
          relation: edge.relation,
          fromNodeId: edge.fromNodeId,
          toNodeId: edge.toNodeId,
        }];
        impacts.push({
          changedNodeId,
          impactedNodeId: edge.fromNodeId,
          distance: edgePath.length,
          nodePath,
          edgePath,
        });
        queue.push({ nodeId: edge.fromNodeId, nodePath, edgePath });
      }
    }
  }
  return impacts.sort((left, right) =>
    left.changedNodeId.localeCompare(right.changedNodeId)
      || left.distance - right.distance
      || left.impactedNodeId.localeCompare(right.impactedNodeId));
}

const manifest = readJson("manifest.json");
const actualJsonFiles = walkJson(root)
  .map((path) => normalizePath(relative(root, path)))
  .sort();

if (manifest) {
  assert(manifest.synthetic === true, "manifest: fixture must be explicitly synthetic");
  assert(manifest.contractVersion === "project-intelligence-vertical-slice/0.1", "manifest: unexpected contract version");
  assert(manifest.projectId === manifest.fixedIds.projectId, "manifest: fixed project ID differs from projectId");
  assert(manifest.organizationId === manifest.fixedIds.organizationId, "manifest: fixed organization ID differs from organizationId");
  assert(sameJson(manifest.fixtureFiles, [...manifest.fixtureFiles].sort()), "manifest: fixtureFiles is not deterministically ordered");
  assert(sameJson([...manifest.fixtureFiles].sort(), actualJsonFiles), "manifest: fixtureFiles does not exactly enumerate every JSON fixture");
  assert(existsSync(join(root, manifest.validator)), `manifest: validator ${manifest.validator} does not exist`);
}

const documents = new Map();
for (const path of actualJsonFiles) {
  const document = path === "manifest.json" ? manifest : readJson(path);
  if (!document) continue;
  documents.set(path, document);
  assert(document.contractVersion === manifest?.contractVersion, `${path}: contractVersion differs from manifest`);
}

const sourcesDocument = documents.get("sources.json");
const fragmentsDocument = documents.get("fragments.json");
const graphV1 = documents.get("graph-v1.json");
const graphV2 = documents.get("graph-v2.json");
const expectedDiff = documents.get("expected-diff.json");
const expectedImpacts = documents.get("expected-impacts.json");
const expectedHandoff = documents.get("expected-handoff.json");

const sources = sourcesDocument?.sources ?? [];
const sourceMap = uniqueById(sources, "sources");
assertSortedById(sources, "sources");
assert(sameJson(sources.map((source) => source.id), manifest?.fixedIds.sourceIds), "manifest: fixed source IDs differ from sources.json");
assert(sameJson(sources.map((source) => source.idempotencyKey), manifest?.fixedIds.idempotencyKeys), "manifest: fixed idempotency keys differ from sources.json");
for (const source of sources) {
  assert(source.projectId === manifest?.projectId, `source ${source.id}: project mismatch`);
  const bytes = Buffer.byteLength(source.fixtureContent, "utf8");
  const checksum = `sha256:${sha256(source.fixtureContent)}`;
  assert(bytes === source.byteLength, `source ${source.id}: byteLength mismatch`);
  assert(checksum === source.checksum, `source ${source.id}: checksum mismatch`);
  assert(manifest?.sourceChecksums[source.id] === source.checksum, `source ${source.id}: manifest checksum mismatch`);
  assert(source.ingestionStatus === "ready", `source ${source.id}: fixture source must be ready`);
  assert(source.createdAt === manifest?.fixedTimestamps.sourcesCreatedAt, `source ${source.id}: createdAt differs from manifest`);
  assert(source.processedAt === manifest?.fixedTimestamps.sourcesProcessedAt, `source ${source.id}: processedAt differs from manifest`);
}
const projectChecksumKeys = new Set();
for (const source of sources) {
  const key = `${source.projectId}:${source.checksum}`;
  assert(!projectChecksumKeys.has(key), `sources: duplicate checksum inside project for ${source.id}`);
  projectChecksumKeys.add(key);
}

const fragments = fragmentsDocument?.fragments ?? [];
const fragmentMap = uniqueById(fragments, "fragments");
assertSortedById(fragments, "fragments");
assert(sameJson(fragments.map((fragment) => fragment.id), manifest?.fixedIds.fragmentIds), "manifest: fixed fragment IDs differ from fragments.json");
for (const fragment of fragments) {
  assert(fragment.projectId === manifest?.projectId, `fragment ${fragment.id}: project mismatch`);
  assert(sourceMap.has(fragment.sourceId), `fragment ${fragment.id}: missing source ${fragment.sourceId}`);
  assert(isPlainObject(fragment.locator) && Object.keys(fragment.locator).length > 0, `fragment ${fragment.id}: locator is empty`);
  assert(fragment.available === true, `fragment ${fragment.id}: happy-path evidence must be available`);
  assert(fragment.createdAt === manifest?.fixedTimestamps.extractionCompletedAt, `fragment ${fragment.id}: createdAt differs from manifest extraction timestamp`);
}

function validateGraph(graph, label) {
  if (!graph) return null;
  assert(graph.projectId === manifest?.projectId, `${label}: project mismatch`);
  const nodes = uniqueById(graph.nodes, `${label}.nodes`);
  const revisions = uniqueById(graph.revisions, `${label}.revisions`);
  const edges = uniqueById(graph.edges, `${label}.edges`);
  const evidence = uniqueById(graph.evidenceLinks, `${label}.evidenceLinks`);
  const reviews = uniqueById(graph.reviews, `${label}.reviews`);
  assertSortedById(graph.nodes, `${label}.nodes`);
  assertSortedById(graph.revisions, `${label}.revisions`);
  assertSortedById(graph.edges, `${label}.edges`);
  assertSortedById(graph.evidenceLinks, `${label}.evidenceLinks`);
  assertSortedById(graph.reviews, `${label}.reviews`);

  const revisionsByNode = new Map();
  for (const revision of graph.revisions) {
    assert(revision.projectId === graph.projectId, `${label}: revision ${revision.id} project mismatch`);
    assert(nodes.has(revision.nodeId), `${label}: revision ${revision.id} references missing node`);
    const list = revisionsByNode.get(revision.nodeId) ?? [];
    list.push(revision);
    revisionsByNode.set(revision.nodeId, list);
    if (revision.replacesRevisionId !== null) {
      const replaced = revisions.get(revision.replacesRevisionId);
      assert(Boolean(replaced), `${label}: revision ${revision.id} replaces a missing revision`);
      assert(replaced?.nodeId === revision.nodeId, `${label}: revision ${revision.id} replaces another node's revision`);
      assert(replaced?.revisionNo + 1 === revision.revisionNo, `${label}: revision ${revision.id} revisionNo is not monotonic`);
    }
    if (revision.claimStatus === "unknown") {
      assert(typeof revision.unknownReason === "string" && revision.unknownReason.trim().length > 0, `${label}: unknown revision ${revision.id} lacks reason`);
    }
  }

  for (const node of graph.nodes) {
    assert(node.projectId === graph.projectId, `${label}: node ${node.id} project mismatch`);
    const current = revisions.get(node.currentRevisionId);
    assert(Boolean(current), `${label}: node ${node.id} current revision is missing`);
    assert(current?.nodeId === node.id, `${label}: node ${node.id} current revision belongs to another node`);
  }

  const semanticEdges = new Set();
  for (const edge of graph.edges) {
    assert(edge.projectId === graph.projectId, `${label}: edge ${edge.id} project mismatch`);
    assert(nodes.has(edge.fromNodeId) && nodes.has(edge.toNodeId), `${label}: edge ${edge.id} references a missing node`);
    assert(edge.fromNodeId !== edge.toNodeId, `${label}: edge ${edge.id} is a self edge`);
    const semanticKey = `${edge.fromNodeId}:${edge.toNodeId}:${edge.relation}`;
    assert(!semanticEdges.has(semanticKey), `${label}: duplicate semantic edge ${edge.id}`);
    semanticEdges.add(semanticKey);
  }

  const evidenceByRevision = new Map();
  for (const link of graph.evidenceLinks) {
    assert(link.projectId === graph.projectId, `${label}: evidence ${link.id} project mismatch`);
    assert(revisions.has(link.nodeRevisionId), `${label}: evidence ${link.id} references a missing revision`);
    assert(fragmentMap.has(link.sourceFragmentId), `${label}: evidence ${link.id} references a missing fragment`);
    const list = evidenceByRevision.get(link.nodeRevisionId) ?? [];
    list.push(link);
    evidenceByRevision.set(link.nodeRevisionId, list);
  }

  const reviewByResultRevision = new Map();
  for (const review of graph.reviews) {
    assert(review.projectId === graph.projectId, `${label}: review ${review.id} project mismatch`);
    assert(revisions.has(review.targetRevisionId), `${label}: review ${review.id} target revision is missing`);
    assert(revisions.has(review.resultingRevisionId), `${label}: review ${review.id} resulting revision is missing`);
    assert(review.actor?.actorType === "human", `${label}: review ${review.id} does not have a human actor`);
    reviewByResultRevision.set(review.resultingRevisionId, review);
  }

  for (const revision of graph.revisions) {
    if (revision.contentOrigin === "ai" && revision.claimStatus !== "unknown") {
      assert((evidenceByRevision.get(revision.id) ?? []).length > 0, `${label}: AI-origin revision ${revision.id} lacks evidence`);
    }
    if (revision.claimStatus === "human_confirmed" || revision.claimStatus === "human_rejected") {
      assert(reviewByResultRevision.has(revision.id), `${label}: human status on ${revision.id} lacks a review targeting that revision result`);
    }
  }

  const snapshotNodes = new Set();
  for (const selected of graph.version.nodeRevisions) {
    assert(!snapshotNodes.has(selected.nodeId), `${label}: version selects node ${selected.nodeId} twice`);
    snapshotNodes.add(selected.nodeId);
    const revision = revisions.get(selected.revisionId);
    assert(nodes.has(selected.nodeId), `${label}: version selects missing node ${selected.nodeId}`);
    assert(revision?.nodeId === selected.nodeId, `${label}: version revision ${selected.revisionId} belongs to another node`);
    assert(nodes.get(selected.nodeId)?.currentRevisionId === selected.revisionId, `${label}: current revision differs from version snapshot for ${selected.nodeId}`);
  }
  assert(snapshotNodes.size === nodes.size, `${label}: version snapshot does not select every node`);
  assert(graph.version.status === "published", `${label}: fixture version must be published`);
  return { nodes, revisions, edges, evidence, reviews, revisionsByNode };
}

const validatedV1 = validateGraph(graphV1, "graph-v1");
const validatedV2 = validateGraph(graphV2, "graph-v2");

if (graphV1 && graphV2 && validatedV1 && validatedV2) {
  assert(sameJson([graphV1.version.id, graphV2.version.id], manifest?.fixedIds.versionIds), "manifest: fixed version IDs differ from graphs");
  assert(sameJson(graphV2.nodes.map((node) => node.id), manifest?.fixedIds.nodeIds), "manifest: fixed node IDs differ from graph-v2.json");
  assert(sameJson(graphV2.revisions.map((revision) => revision.id), manifest?.fixedIds.revisionIds), "manifest: fixed revision IDs differ from graph-v2.json");
  assert(sameJson(graphV2.edges.map((edge) => edge.id), manifest?.fixedIds.edgeIds), "manifest: fixed edge IDs differ from graph-v2.json");
  assert(sameJson(graphV2.evidenceLinks.map((link) => link.id), manifest?.fixedIds.evidenceLinkIds), "manifest: fixed evidence IDs differ from graph-v2.json");
  assert(sameJson(graphV2.reviews.map((review) => review.id), manifest?.fixedIds.reviewIds), "manifest: fixed review IDs differ from graph-v2.json");
  const actorIds = [...new Set([
    graphV1.version.publishedBy.actorId,
    graphV2.version.publishedBy.actorId,
    graphV2.changeSet.actor.actorId,
    ...graphV2.reviews.map((review) => review.actor.actorId),
    ...(expectedImpacts?.impacts ?? []).map((impact) => impact.review.actorId),
  ])].sort();
  assert(sameJson(actorIds, manifest?.fixedIds.actorIds), "manifest: fixed actor IDs differ from graph/impact fixtures");
  assert(graphV1.version.versionNo === 1 && graphV2.version.versionNo === 2, "versions: expected monotonic V1/V2 numbers");
  assert(graphV1.version.publishedAt === manifest?.fixedTimestamps.v1PublishedAt, "manifest: V1 publish timestamp mismatch");
  assert(graphV2.version.publishedAt === manifest?.fixedTimestamps.v2PublishedAt, "manifest: V2 publish timestamp mismatch");
  assert(graphV2.changeSet.occurredAt === manifest?.fixedTimestamps.decisionChangedAt, "manifest: decision change timestamp mismatch");
  assert(graphV2.reviews.find((review) => review.id === "review-decision-r1")?.occurredAt === manifest?.fixedTimestamps.initialReviewAt, "manifest: initial decision review timestamp mismatch");
  assert(graphV2.reviews.find((review) => review.id === "review-requirement-r1")?.occurredAt === manifest?.fixedTimestamps.initialReviewAt, "manifest: initial requirement review timestamp mismatch");
  assert(graphV2.reviews.find((review) => review.id === "review-decision-r2-edit")?.occurredAt === manifest?.fixedTimestamps.decisionChangedAt, "manifest: decision edit review timestamp mismatch");
  assert(graphV2.version.baseVersionId === graphV1.version.id, "versions: V2 baseVersionId does not reference V1");
  assert(graphV1.version.id !== graphV2.version.id, "versions: V1 and V2 ids must differ");
  const v1Before = canonicalJson(graphV1);
  const calculatedDiff = diffVersions(graphV1, graphV2);
  assert(canonicalJson(graphV1) === v1Before, "diff: calculation mutated published V1");
  assert(sameJson(calculatedDiff, expectedDiff?.changes), "diff: calculated changes differ from expected-diff.json");
  assert(calculatedDiff.length === 1, "diff: happy path must contain exactly one changed node");
  assert(sameJson(calculatedDiff[0]?.changedPaths, ["/material"]), "diff: expected the single JSON Pointer /material");

  const allNodeIds = graphV1.nodes.map((node) => node.id).sort();
  const changedIds = new Set(calculatedDiff.map((change) => change.nodeId));
  const unchanged = allNodeIds.filter((id) => !changedIds.has(id));
  assert(sameJson(unchanged, expectedDiff?.unchangedNodeIds), "diff: unchangedNodeIds mismatch");
  assert(expectedDiff?.changeSet.id === graphV2.changeSet?.id, "diff: change-set id mismatch");
  assert(expectedDiff?.changeSet.reasonCode === graphV2.changeSet?.reasonCode, "diff: reason code mismatch");
  assert(expectedDiff?.changeSet.actorType === "human", "diff: change-set actor must be human");

  const propagating = new Set(expectedImpacts?.algorithm.propagatingRelations ?? []);
  const calculatedImpacts = calculateImpact(graphV2.nodes, graphV2.edges, calculatedDiff.map((change) => change.nodeId), propagating);
  const expectedImpactCore = (expectedImpacts?.impacts ?? []).map((impact) => ({
    changedNodeId: impact.changedNodeId,
    impactedNodeId: impact.impactedNodeId,
    distance: impact.distance,
    nodePath: impact.nodePath,
    edgePath: impact.edgePath,
  }));
  assert(sameJson(calculatedImpacts, expectedImpactCore), "impact: calculated paths differ from expected-impacts.json");
  assert(sameJson((expectedImpacts?.impacts ?? []).map((impact) => impact.id), manifest?.fixedIds.impactIds), "manifest: fixed impact IDs differ from expected impacts");
  assert(expectedImpacts?.calculatedAt === manifest?.fixedTimestamps.impactCalculatedAt, "manifest: impact calculation timestamp mismatch");
  assert(expectedImpacts?.impacts.find((impact) => impact.id === "impact-item-kitchen-worktop")?.review.reviewedAt === manifest?.fixedTimestamps.itemImpactReviewedAt, "manifest: Item impact review timestamp mismatch");
  assert(expectedImpacts?.impacts.find((impact) => impact.id === "impact-deliverable-budget")?.review.reviewedAt === manifest?.fixedTimestamps.budgetImpactReviewedAt, "manifest: Budget impact review timestamp mismatch");
  assert(expectedImpacts?.impacts.find((impact) => impact.id === "impact-deliverable-finish-schedule")?.review.reviewedAt === manifest?.fixedTimestamps.finishImpactReviewedAt, "manifest: Finish impact review timestamp mismatch");
  const repeatedImpacts = calculateImpact([...graphV2.nodes].reverse(), [...graphV2.edges].reverse(), calculatedDiff.map((change) => change.nodeId), propagating);
  assert(sameJson(calculatedImpacts, repeatedImpacts), "impact: result depends on input ordering");
  assert(!calculatedImpacts.some((impact) => impact.impactedNodeId === "risk-natural-stone-lead-time"), "impact: non-propagating risk was included");
  for (const impact of expectedImpacts?.impacts ?? []) {
    assert(impact.distance === impact.edgePath.length, `impact ${impact.id}: distance differs from edge path length`);
    assert(impact.nodePath.length === impact.edgePath.length + 1, `impact ${impact.id}: node path is discontinuous`);
    for (let index = 0; index < impact.edgePath.length; index += 1) {
      const step = impact.edgePath[index];
      assert(step.toNodeId === impact.nodePath[index], `impact ${impact.id}: edge ${step.edgeId} target breaks path continuity`);
      assert(step.fromNodeId === impact.nodePath[index + 1], `impact ${impact.id}: edge ${step.edgeId} source breaks path continuity`);
      assert(validatedV2.edges.has(step.edgeId), `impact ${impact.id}: edge ${step.edgeId} is missing from V2 graph`);
    }
    assert(impact.review.actorType === "human", `impact ${impact.id}: disposition lacks human actor`);
  }
}

function evaluateInvalidCase(testCase) {
  switch (testCase.caseType) {
    case "unsourced_ai_claim":
      return testCase.revision.contentOrigin === "ai"
        && ["extracted", "interpreted"].includes(testCase.revision.claimStatus)
        && testCase.evidenceLinks.length === 0
        ? "AI_CLAIM_MISSING_EVIDENCE" : null;
    case "ai_human_confirmation":
      return testCase.reviewCommand.actor.actorType !== "human" ? "AI_HUMAN_REVIEW_FORBIDDEN" : null;
    case "unknown_without_reason":
      return testCase.revision.claimStatus === "unknown" && !testCase.revision.unknownReason?.trim()
        ? "UNKNOWN_REASON_REQUIRED" : null;
    case "cross_project_edge": {
      const nodeProjects = new Map(testCase.nodes.map((node) => [node.id, node.projectId]));
      return nodeProjects.get(testCase.edge.fromNodeId) !== testCase.projectId
        || nodeProjects.get(testCase.edge.toNodeId) !== testCase.projectId
        ? "PROJECT_SCOPE_VIOLATION" : null;
    }
    case "stale_review":
      return testCase.reviewCommand.expectedRevisionId !== testCase.currentRevisionId ? "REVISION_STALE" : null;
    case "unavailable_fragment":
      return testCase.fragment.available === false
        && (!testCase.reviewCommand.evidenceAcknowledgement?.reason?.trim())
        ? "EVIDENCE_ACK_REQUIRED" : null;
    case "missing_change_reason":
      return !testCase.reviseDecisionCommand.reason?.trim() ? "CHANGE_REASON_REQUIRED" : null;
    case "idempotency_conflict":
      return testCase.firstCommand.idempotencyKey === testCase.replayedCommand.idempotencyKey
        && testCase.firstCommand.requestDigest !== testCase.replayedCommand.requestDigest
        ? "IDEMPOTENCY_CONFLICT" : null;
    default:
      return null;
  }
}

for (const [path, document] of documents) {
  if (!path.startsWith("invalid-cases/") || document.caseType === "cycle") continue;
  const actualCode = evaluateInvalidCase(document);
  assert(actualCode === document.expectedError.code, `${path}: expected ${document.expectedError.code}, received ${actualCode ?? "no error"}`);
}

const invalidCaseIds = [...documents.entries()]
  .filter(([path]) => path.startsWith("invalid-cases/"))
  .map(([, document]) => document.caseId)
  .sort();
assert(sameJson(invalidCaseIds, manifest?.fixedIds.invalidCaseIds), "manifest: fixed invalid-case IDs differ from fixture files");

const cycleCase = documents.get("invalid-cases/cycle.json");
if (cycleCase) {
  const cycleImpacts = calculateImpact(
    cycleCase.nodes,
    cycleCase.edges,
    cycleCase.changedNodeIds,
    new Set(["depends_on", "derived_from", "satisfies", "specified_by"]),
  );
  const impactedIds = cycleImpacts.map((impact) => impact.impactedNodeId);
  assert(sameJson(impactedIds, cycleCase.expectedOutcome.impactedNodeIds), "cycle: impacted node order/content mismatch");
  assert(new Set([...cycleCase.changedNodeIds, ...impactedIds]).size <= cycleCase.expectedOutcome.maximumVisitedNodeCount, "cycle: traversal exceeded maximum visited nodes");
  assert(new Set(impactedIds).size === impactedIds.length, "cycle: traversal emitted duplicate impacts");
}

if (expectedHandoff && graphV2 && expectedImpacts) {
  const logicalContent = expectedHandoff.logicalContent;
  const calculatedHash = `sha256:${sha256(canonicalJson(logicalContent))}`;
  assert(
    calculatedHash === expectedHandoff.artifact.semanticContentHash,
    `handoff: semantic hash mismatch; expected fixture value ${calculatedHash}`,
  );
  assert(calculatedHash === `sha256:${sha256(canonicalJson(logicalContent))}`, "handoff: repeated render hash is not deterministic");
  assert(logicalContent.project.projectId === graphV2.projectId, "handoff: project id mismatch");
  assert(logicalContent.project.versionId === graphV2.version.id, "handoff: version id mismatch");
  assert(expectedHandoff.artifact.artifactId === manifest?.fixedIds.exportId, "manifest: fixed export ID differs from handoff fixture");
  assert(expectedHandoff.artifact.generatedAt === manifest?.fixedTimestamps.handoffGeneratedAt, "manifest: handoff timestamp mismatch");
  for (const excluded of expectedHandoff.hashContract.excludedVolatileFields) {
    assert(!(excluded in logicalContent), `handoff: volatile field ${excluded} leaked into logicalContent`);
  }
  const handoffReferences = uniqueById(logicalContent.sourceReferences, "handoff.sourceReferences");
  assertSortedById(logicalContent.sourceReferences, "handoff.sourceReferences");
  for (const reference of handoffReferences.values()) {
    assert(sourceMap.has(reference.sourceId), `handoff reference ${reference.id}: source does not exist`);
    assert(fragmentMap.has(reference.fragmentId), `handoff reference ${reference.id}: fragment does not exist`);
    assert(!("signedUrl" in reference), `handoff reference ${reference.id}: signed URL is forbidden`);
  }
  const graphV2Revisions = new Set(graphV2.revisions.map((revision) => revision.id));
  for (const collection of [logicalContent.areas, logicalContent.requirements, logicalContent.decisions, logicalContent.items, logicalContent.deliverables]) {
    for (const entity of collection) assert(graphV2Revisions.has(entity.revisionId), `handoff: revision ${entity.revisionId} is absent from V2 graph`);
  }
  const expectedImpactIds = new Set(expectedImpacts.impacts.map((impact) => impact.id));
  const handoffImpactIds = [
    ...logicalContent.impacts.unresolved.map((impact) => impact.impactId),
    ...logicalContent.impacts.resolved.map((impact) => impact.impactId),
  ];
  assert(handoffImpactIds.length === expectedImpactIds.size, "handoff: impact count mismatch");
  assert(handoffImpactIds.every((id) => expectedImpactIds.has(id)), "handoff: unknown impact id");
  assert(!handoffImpactIds.includes("risk-natural-stone-lead-time"), "handoff: non-propagating risk appears as impact");
}

function scanStrings(value, path, findings) {
  if (typeof value === "string") {
    const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
    const signedUrl = /https?:\/\/\S+\?\S*(?:token|signature|x-amz-|sig=)/i;
    const secret = /(?:\bsk-[A-Za-z0-9_-]{16,}|\bservice[_-]?role[_-]?key\b|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.)/i;
    const phoneLike = /^\+?[\d ()-]{9,}\d$/;
    const digits = value.replace(/\D/g, "");
    if (email.test(value)) findings.push(`${path}: email-like value`);
    if (signedUrl.test(value)) findings.push(`${path}: signed URL-like value`);
    if (secret.test(value)) findings.push(`${path}: secret-like value`);
    if (phoneLike.test(value) && digits.length >= 10 && digits.length <= 15) findings.push(`${path}: phone-like value`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanStrings(item, `${path}[${index}]`, findings));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) scanStrings(item, `${path}.${key}`, findings);
  }
}

const privacyFindings = [];
for (const [path, document] of documents) scanStrings(document, path, privacyFindings);
assert(privacyFindings.length === 0, `privacy scan: ${privacyFindings.sort().join("; ")}`);

if (failures.length > 0) {
  for (const failure of [...new Set(failures)].sort()) console.error(`FAIL ${failure}`);
  console.error(`Fixture validation failed with ${new Set(failures).size} issue(s).`);
  process.exitCode = 1;
} else {
  console.log(`Fixture validation passed: ${actualJsonFiles.length} JSON files, ${sources.length} sources, ${fragments.length} fragments, ${expectedImpacts?.impacts.length ?? 0} impacts.`);
  console.log("PII/secret/signed-URL scan passed.");
}
