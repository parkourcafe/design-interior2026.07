import { canonicalJson } from "../../lib/project-intelligence/application/change-handoff/canonical";

export function buildExternalProofFixture(input: {
  readonly scope: { readonly organizationId: string; readonly projectId: string; readonly packageId: string };
  readonly commands: readonly Record<string, unknown>[];
  readonly manifestDigest: string;
  readonly challengeNonce: string;
  readonly uuid: (index: number) => string;
  readonly sha: (value: string) => string;
  readonly idBase?: number;
}): Record<string, unknown> {
  const idBase = input.idBase ?? 900;
  const commandIds = input.commands.map((command) => command.commandId);
  const sources: Record<string, unknown> = {
    audit: input.commands.map((command) => ({
      auditEventId: command.auditEventId,
      requestId: command.requestId,
      commandId: command.commandId,
      actorUserId: command.actorUserId,
    })),
    authenticatedRead: { requestId: input.uuid(idBase), projectId: input.scope.projectId, status: true },
    privacy: {
      requestIds: [input.uuid(idBase + 1), input.uuid(idBase + 3), input.uuid(idBase + 4), input.uuid(idBase + 5), input.uuid(idBase + 6)],
      forbiddenFieldCount: 0,
    },
    tenancy: { requestId: input.uuid(idBase + 2), guestContract: "empty_portfolio", projectCount: 0, externalProjectAbsent: true },
    replay: input.commands.map((command) => ({
      commandId: command.commandId,
      requestId: command.requestId,
      auditEventId: command.auditEventId,
      replayMode: command.replayMode,
      resultDigest: command.resultDigest,
      replayDigest: command.replayDigest,
      replayEqual: command.replayMode === "direct" ? true : null,
      sideEffectCount: command.replayMode === "parent_atomic_side_effect" ? 1 : null,
    })),
  };
  const proofKeys = ["audit", "authenticatedRead", "privacy", "tenancy", "replay"] as const;
  return Object.fromEntries(proofKeys.map((kind) => {
    const source = sources[kind];
    const queryRequestId = kind === "audit"
      ? String(input.commands[0]!.requestId)
      : kind === "replay"
        ? String(input.commands[1]!.requestId)
        : kind === "privacy"
          ? String((source as { requestIds: unknown[] }).requestIds[0])
          : String((source as { requestId: unknown }).requestId);
    const auditEventIds = kind === "audit" || kind === "replay"
      ? input.commands.map((command) => command.auditEventId)
      : [];
    return [kind, {
      kind,
      queryRequestId,
      auditEventIds,
      resultDigest: input.sha(canonicalJson(source)),
      ...input.scope,
      manifestDigest: input.manifestDigest,
      challengeNonce: input.challengeNonce,
      commandIds,
      source,
    }];
  }));
}
