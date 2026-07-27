export interface ResolvedValue<T> {
  value: T;
  source: "approved_project_decision" | "project_override" | "studio_default" | "platform_default";
  studioStandardVersionId: string | null;
}

export function resolveStudioValue<T>(input: {
  approvedProjectDecision?: T;
  projectOverride?: T;
  studioDefault?: { value: T; versionId: string };
  platformDefault: T;
}): ResolvedValue<T> {
  if (input.approvedProjectDecision !== undefined) {
    return { value: input.approvedProjectDecision, source: "approved_project_decision", studioStandardVersionId: input.studioDefault?.versionId ?? null };
  }
  if (input.projectOverride !== undefined) {
    return { value: input.projectOverride, source: "project_override", studioStandardVersionId: input.studioDefault?.versionId ?? null };
  }
  if (input.studioDefault) {
    return { value: input.studioDefault.value, source: "studio_default", studioStandardVersionId: input.studioDefault.versionId };
  }
  return { value: input.platformDefault, source: "platform_default", studioStandardVersionId: null };
}

