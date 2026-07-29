import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import {
  resolveStudioValueWithDrift,
  type StudioResolutionInput,
  type ResolvedValue,
  type StandardDrift,
} from "@/lib/platform/studio-resolver";

export interface ProjectStudioResolutionInput<T> {
  projectId: string;
  standardKey: string;
  platformDefault: T;
  schema: z.ZodType<T>;
}

export interface ProjectStudioResolution<T> extends ResolvedValue<T> {
  projectId: string;
  standardKey: string;
  projectOverrideId: string | null;
  drift: StandardDrift | null;
}

interface ProjectRow {
  id: string;
  designer_id: string;
}

interface ProjectOverrideRow {
  id: string;
  value: unknown;
  approved: boolean;
  standard_version_id: string | null;
}

interface StudioStandardRow {
  id: string;
  value: unknown;
  version: number;
}

function isProjectRow(value: unknown): value is ProjectRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.designer_id === "string";
}

function isProjectOverrideRow(value: unknown): value is ProjectOverrideRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string"
    && typeof row.approved === "boolean"
    && (
      row.standard_version_id === null
      || typeof row.standard_version_id === "string"
    )
    && Object.hasOwn(row, "value")
  );
}

function isStudioStandardRow(value: unknown): value is StudioStandardRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string"
    && typeof row.version === "number"
    && Number.isInteger(row.version)
    && row.version > 0
    && Object.hasOwn(row, "value")
  );
}

export async function resolveProjectStudioValue<T>(
  db: SupabaseClient,
  input: ProjectStudioResolutionInput<T>,
): Promise<ProjectStudioResolution<T>> {
  if (!input.standardKey.trim() || input.standardKey.length > 128) {
    throw new Error("studio_resolution_invalid_standard_key");
  }

  const platformDefault = input.schema.safeParse(input.platformDefault);
  if (!platformDefault.success) {
    throw new Error("studio_resolution_invalid_platform_default");
  }

  // This is deliberately the request-bound client. Project RLS is the first
  // boundary, and no service-role client is created by the resolver.
  const { data: projectData, error: projectError } = await db
    .from("projects")
    .select("id,designer_id")
    .eq("id", input.projectId)
    .maybeSingle();
  if (projectError || !isProjectRow(projectData)) {
    throw new Error("studio_resolution_project_not_accessible");
  }

  const [overrideResult, currentStandardResult] = await Promise.all([
    db
      .from("project_overrides")
      .select("id,value,approved,standard_version_id")
      .eq("project_id", projectData.id)
      .eq("standard_key", input.standardKey)
      .maybeSingle(),
    db
      .from("studio_standards")
      .select("id,value,version")
      .eq("studio_id", projectData.designer_id)
      .eq("standard_key", input.standardKey)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (overrideResult.error) {
    throw new Error("studio_resolution_project_override_read_failed");
  }
  if (currentStandardResult.error) {
    throw new Error("studio_resolution_studio_default_read_failed");
  }

  const overrideData = overrideResult.data;
  if (overrideData !== null && !isProjectOverrideRow(overrideData)) {
    throw new Error("studio_resolution_invalid_project_override");
  }
  const currentStandardData = currentStandardResult.data;
  if (
    currentStandardData !== null
    && !isStudioStandardRow(currentStandardData)
  ) {
    throw new Error("studio_resolution_invalid_studio_default");
  }

  const override = overrideData as ProjectOverrideRow | null;
  const currentStandard = currentStandardData as StudioStandardRow | null;

  if (override?.standard_version_id) {
    const { data: pinnedData, error: pinnedError } = await db
      .from("studio_standards")
      .select("id")
      .eq("id", override.standard_version_id)
      .eq("studio_id", projectData.designer_id)
      .eq("standard_key", input.standardKey)
      .maybeSingle();
    if (
      pinnedError
      || !pinnedData
      || typeof (pinnedData as { id?: unknown }).id !== "string"
      || (pinnedData as { id: string }).id !== override.standard_version_id
    ) {
      throw new Error("studio_resolution_invalid_pinned_standard");
    }
  }

  const resolutionInput: StudioResolutionInput<T> = {
    platformDefault: platformDefault.data,
  };

  if (override) {
    const parsedOverride = input.schema.safeParse(override.value);
    if (!parsedOverride.success) {
      throw new Error("studio_resolution_invalid_project_value");
    }
    if (override.approved) {
      resolutionInput.approvedProjectDecision = parsedOverride.data;
    } else {
      resolutionInput.projectOverride = parsedOverride.data;
    }
    resolutionInput.referencedStudioStandardVersionId =
      override.standard_version_id;
  }

  if (currentStandard) {
    // A selected project value is preserved even if a newer studio value has
    // become malformed; only its immutable version identity is needed for
    // drift. Without a project value, malformed current defaults fail closed.
    let currentValue = platformDefault.data;
    if (!override) {
      const parsedCurrent = input.schema.safeParse(currentStandard.value);
      if (!parsedCurrent.success) {
        throw new Error("studio_resolution_invalid_studio_value");
      }
      currentValue = parsedCurrent.data;
    }
    resolutionInput.studioDefault = {
      value: currentValue,
      versionId: currentStandard.id,
    };
  }

  const resolved = resolveStudioValueWithDrift(resolutionInput);
  return {
    projectId: projectData.id,
    standardKey: input.standardKey,
    projectOverrideId: override?.id ?? null,
    ...resolved,
  };
}
