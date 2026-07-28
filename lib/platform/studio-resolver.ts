export interface ResolvedValue<T> {
  value: T;
  source: "approved_project_decision" | "project_override" | "studio_default" | "platform_default";
  studioStandardVersionId: string | null;
}

export interface StandardDrift {
  type: "standard_drift";
  previousStudioStandardVersionId: string;
  currentStudioStandardVersionId: string;
}

export interface StudioResolutionInput<T> {
  approvedProjectDecision?: T;
  projectOverride?: T;
  referencedStudioStandardVersionId?: string | null;
  studioDefault?: { value: T; versionId: string };
  platformDefault: T;
}

export function resolveStudioValue<T>(
  input: StudioResolutionInput<T>,
): ResolvedValue<T> {
  if (input.approvedProjectDecision !== undefined) {
    return {
      value: input.approvedProjectDecision,
      source: "approved_project_decision",
      studioStandardVersionId:
        input.referencedStudioStandardVersionId ?? null,
    };
  }
  if (input.projectOverride !== undefined) {
    return {
      value: input.projectOverride,
      source: "project_override",
      studioStandardVersionId:
        input.referencedStudioStandardVersionId ?? null,
    };
  }
  if (input.studioDefault) {
    return {
      value: input.studioDefault.value,
      source: "studio_default",
      studioStandardVersionId: input.studioDefault.versionId,
    };
  }
  return {
    value: input.platformDefault,
    source: "platform_default",
    studioStandardVersionId: null,
  };
}

export function resolveStudioValueWithDrift<T>(
  input: StudioResolutionInput<T>,
): ResolvedValue<T> & { drift: StandardDrift | null } {
  const resolved = resolveStudioValue(input);
  const previousVersionId = resolved.studioStandardVersionId;
  const currentVersionId = input.studioDefault?.versionId;
  const hasPinnedProjectValue =
    resolved.source === "approved_project_decision" ||
    resolved.source === "project_override";
  const drift =
    hasPinnedProjectValue &&
    previousVersionId !== null &&
    currentVersionId !== undefined &&
    previousVersionId !== currentVersionId
      ? {
          type: "standard_drift" as const,
          previousStudioStandardVersionId: previousVersionId,
          currentStudioStandardVersionId: currentVersionId,
        }
      : null;

  return { ...resolved, drift };
}
