# Agent 3 public interface summary

Public boundary:

```text
lib/project-intelligence/application/change-handoff/index.ts
```

Integrator re-exports this boundary from its owned application index. The module imports
only the frozen public Project Intelligence domain API and never imports Agent 2 workflow
private files.

## Runtime exports

| Symbol | Contract |
|---|---|
| `CHANGE_HANDOFF_APPLICATION_ERROR_CODES` | Stable application error allowlist |
| `CHANGE_HANDOFF_CAPABILITIES` | Server capability vocabulary |
| `APPLICATION_ACTOR_TYPES` | Runtime actor vocabulary: `human | ai | system` |
| `IMPACT_DISPOSITIONS` | `accepted | resolved | dismissed` |
| `IMPACT_STATUSES` | `needs_review` plus the controlled dispositions |
| `IMPACT_REASON_CODES` | Controlled persisted/audited impact-review reason vocabulary |
| `canonicalJson(value)` | Recursive code-point key ordering; only dense data-property arrays are accepted |
| `semanticSha256(value)` | `sha256:<hex>` over UTF-8 canonical JSON |
| `createDeterministicChangeHandoffIdFactory()` | Default server-side semantic ID factory |
| `createEmptyChangeHandoffState(organizationId, projectId)` | Immutable initial owning-port state |
| `ChangeHandoffApplicationService` | `calculateImpactRun`, `reviewImpact`, `buildLogicalHandoff` façade |

## Exported types

Application/context/result:

```text
JsonObject
ChangeHandoffApplicationErrorCode
ChangeHandoffApplicationError
ChangeHandoffApplicationResult<T>
ChangeHandoffCapability
ApplicationActorType
ApplicationActorContext
ApplicationExecutionContext
ChangeContext
ChangeHandoffApplicationServiceOptions
```

Impact/review:

```text
ImpactAlgorithmDescriptor
ImpactStatus
ImpactDisposition
ImpactReasonCode
PersistedImpact
ImpactRun
ImpactReview
CalculateImpactRunCommand
ReviewImpactCommand
```

Handoff:

```text
PublishedProjectVersion
HandoffSourceReferenceProjection
HandoffPolicyInput
EffectiveClaimStatus
LogicalHandoffArea
LogicalHandoffRequirement
LogicalHandoffDecisionProvenance
LogicalHandoffDecision
LogicalHandoffItem
LogicalHandoffDeliverable
LogicalHandoffSourceReference
LogicalHandoffImpact
LogicalHandoffContent
HandoffArtifactDescriptor
LogicalHandoff
BuildLogicalHandoffCommand
```

Atomic owner/idempotency/audit:

```text
ChangeHandoffAuditEventName
ChangeHandoffAuditIntent
ChangeHandoffOperation
ChangeHandoffMutationValue
ChangeHandoffIdempotencyRecord
ChangeHandoffApplicationState
ChangeHandoffMutationSuccess<T>
ChangeHandoffIdKind
ChangeHandoffIdInput
ChangeHandoffIdFactory
```

Test adapter/support symbols are not exported.

## Method signatures and outcomes

```ts
calculateImpactRun(
  command: CalculateImpactRunCommand,
): ChangeHandoffApplicationResult<ChangeHandoffMutationSuccess<ImpactRun>>;

reviewImpact(
  command: ReviewImpactCommand,
): ChangeHandoffApplicationResult<ChangeHandoffMutationSuccess<ImpactReview>>;

buildLogicalHandoff(
  command: BuildLogicalHandoffCommand,
): ChangeHandoffApplicationResult<ChangeHandoffMutationSuccess<LogicalHandoff>>;
```

Success transition:

```text
result              immutable logical result
nextState           immutable complete next state for owning atomic commit
idempotentReplay    false for new transition, true for same scoped key/digest
auditIntents        one controlled intent for new transition, [] on replay
requestDigest       canonical digest excluding serverTime/requestId
```

Failure has no `nextState` or audit intent. Caller retains its original state unchanged.

`ImpactRun` additionally persists:

```text
changeContext       normalized full calculation-time ChangeContext
targetGraphDigest   SHA-256 of the normalized exact calculation-time ProjectGraphSnapshot
resultDigest        impact result digest that also commits to targetGraphDigest
```

Review and handoff commands must supply that exact immutable run. Handoff independently
recomputes the normalized target graph digest and compares its `ChangeContext` with the
run. Review idempotency digests include the complete run, so a context/digest substitution
cannot replay an earlier review.

## Integrator example

```ts
import {
  ChangeHandoffApplicationService,
  createEmptyChangeHandoffState,
  type ApplicationExecutionContext,
  type ChangeContext,
  type ChangeHandoffIdFactory,
  type HandoffPolicyInput,
  type PublishedProjectVersion,
} from "@/lib/project-intelligence/application/change-handoff";

const service = new ChangeHandoffApplicationService({
  idFactory: trustedServerIdFactory satisfies ChangeHandoffIdFactory,
});

let state = createEmptyChangeHandoffState(organizationId, projectId);

const calculation = service.calculateImpactRun({
  execution: impactWorkerContext satisfies ApplicationExecutionContext,
  state,
  expectedStateRevision: state.stateRevision,
  changeContext: workflowChangeSetContext satisfies ChangeContext,
  fromVersion: publishedV1Snapshot,
  toVersion: publishedV2Snapshot,
  targetGraph: exactPublishedV2Graph,
  idempotencyKey: impactCommandKey,
});
if (!calculation.ok) return calculation;
await owner.commitAtomically(state.stateRevision, calculation.value.nextState,
  calculation.value.auditIntents);
state = calculation.value.nextState;

for (const requestedReview of humanImpactReviews) {
  const reviewed = service.reviewImpact({
    execution: humanExecutionContext,
    state,
    expectedStateRevision: state.stateRevision,
    impactRun: calculation.value.result,
    impactId: requestedReview.impactId,
    expectedImpactStatus: requestedReview.expectedStatus,
    disposition: requestedReview.disposition,
    reasonCode: requestedReview.reasonCode,
    idempotencyKey: requestedReview.idempotencyKey,
  });
  if (!reviewed.ok) return reviewed;
  await owner.commitAtomically(state.stateRevision, reviewed.value.nextState,
    reviewed.value.auditIntents);
  state = reviewed.value.nextState;
}

const targetVersion: PublishedProjectVersion = {
  status: "published",
  snapshot: publishedV2Snapshot,
  versionNo: 2,
  baseVersionId: publishedV1Snapshot.versionId,
  label: publishedV2Label,
};
const policy: HandoffPolicyInput = trustedEditionDisplayPolicy;
const handoff = service.buildLogicalHandoff({
  execution: exportWorkerContext,
  state,
  expectedStateRevision: state.stateRevision,
  changeContext: workflowChangeSetContext,
  targetVersion,
  targetGraph: exactPublishedV2Graph,
  impactRun: calculation.value.result,
  reviews: state.impactReviews.filter(
    (review) => review.impactRunId === calculation.value.result.id,
  ),
  policy,
  idempotencyKey: handoffCommandKey,
});
```

`fromVersion`, `toVersion` and `targetGraph` are frozen public domain
`ProjectVersionSnapshot` / `ProjectGraphSnapshot` values. Caller cannot supply roots,
impacted nodes or graph edges separately.

## Canonicalization and trusted source projection

- Object keys: recursive frozen `compareCodePoints` order.
- Arrays: order is preserved only for dense own data-property indices; holes, named
  properties, symbols and accessor elements are rejected as non-canonical.
- Contract arrays: explicitly sorted by stable ID/node ID, except ordered dependency paths
  and immutable impact result order, which are deliberately preserved.
- SHA-256 input: `LogicalHandoff.logicalContent` only.
- Excluded from hash: artifact ID, generation time, job status; signed URL is never part of
  the type or content.
- `HandoffSourceReferenceProjection` may retain the richer application questionnaire
  locator from CG-018. It is trusted server policy input, keyed by an evidence link that
  must exist in the exact graph. It cannot add an unknown source/fragment/evidence link,
  and calculation-time graph digest binding prevents later evidence/source/fragment swaps.

## Runtime vocabulary enforcement

TypeScript unions are not treated as a security boundary. Before persistence or controlled
audit emission, the service validates execution actor type, every capability, expected
impact status, disposition and impact-review reason against the exported vocabularies.
Stored/supplied review snapshots are revalidated as well. `ReviewImpactCommand.reasonCode`
is intentionally a transport-boundary `string`; a successful `ImpactReview.reasonCode` is
the narrowed `ImpactReasonCode`.

## L1 vocabulary compatibility

Wave 2 L1 vocabulary is authoritative. Integrator may map older vertical proposal labels
at delivery/read-model boundaries without changing this module:

| Wave 2 L1 | Older proposal |
|---|---|
| failure `IMPACT_STALE` | optimistic impact conflict represented as `INVALID_TRANSITION` |
| disposition `dismissed` | `not_applicable` |
| audit intent `impact_run_created` | `impact_set_calculated` |
| audit intent `logical_handoff_built` | render/read-model event `handoff_generated` |

`logical_handoff_built` means deterministic logical JSON is ready. It does not mean a
PDF/DOCX renderer or durable artifact job completed.
