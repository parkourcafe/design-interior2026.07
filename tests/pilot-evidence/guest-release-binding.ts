export function resolveGuestGraphVersion(
  workspace: unknown, packageId: string, productionVersionId: string,
): string {
  const object = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown> : {};
  const envelope = object(workspace);
  const data = object(envelope.data);
  const baseline = object(data.latestBaseline);
  const versions = Array.isArray(data.packageVersions) ? data.packageVersions : [];
  const matching = versions.map(object).filter((entry) =>
    entry.id === productionVersionId && entry.packageId === packageId);
  if (envelope.error || matching.length !== 1 || typeof baseline.id !== "string"
    || matching[0]?.baselineId !== baseline.id
    || typeof baseline.graphVersionId !== "string" || baseline.graphVersionId.length === 0) {
    throw new Error("AP1_GUEST_RELEASE_GRAPH_BINDING_MISSING");
  }
  return baseline.graphVersionId;
}
