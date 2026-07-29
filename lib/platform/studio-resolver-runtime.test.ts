import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { resolveProjectStudioValue } from "./studio-resolver-runtime";

const projectId = "00000000-0000-4000-8000-000000000101";
const studioId = "00000000-0000-4000-8000-000000000201";
const overrideId = "00000000-0000-4000-8000-000000000301";
const pinnedVersionId = "00000000-0000-4000-8000-000000000401";
const currentVersionId = "00000000-0000-4000-8000-000000000402";
const standardKey = "proposal.complexity";
const complexitySchema = z.enum(["low", "mid", "high"]);

interface FakeRows {
  project?: Record<string, unknown> | null;
  projectError?: { message: string } | null;
  override?: Record<string, unknown> | null;
  overrideError?: { message: string } | null;
  currentStandard?: Record<string, unknown> | null;
  currentStandardError?: { message: string } | null;
  pinnedStandard?: Record<string, unknown> | null;
  pinnedStandardError?: { message: string } | null;
}

interface QueryTrace {
  table: string;
  operation: string;
  args: unknown[];
}

function fakeActorClient(rows: FakeRows = {}) {
  const trace: QueryTrace[] = [];

  const from = vi.fn((table: string) => {
    const filters = new Map<string, unknown>();
    const query = {
      select(columns: string) {
        trace.push({ table, operation: "select", args: [columns] });
        return query;
      },
      eq(column: string, value: unknown) {
        filters.set(column, value);
        trace.push({ table, operation: "eq", args: [column, value] });
        return query;
      },
      order(column: string, options: unknown) {
        trace.push({ table, operation: "order", args: [column, options] });
        return query;
      },
      limit(count: number) {
        trace.push({ table, operation: "limit", args: [count] });
        return query;
      },
      async maybeSingle() {
        trace.push({ table, operation: "maybeSingle", args: [] });
        if (table === "projects") {
          return {
            data: rows.project === undefined
              ? { id: projectId, designer_id: studioId }
              : rows.project,
            error: rows.projectError ?? null,
          };
        }
        if (table === "project_overrides") {
          return {
            data: rows.override ?? null,
            error: rows.overrideError ?? null,
          };
        }
        if (table === "studio_standards") {
          const pinned = filters.has("id");
          return {
            data: pinned
              ? (rows.pinnedStandard ?? null)
              : (rows.currentStandard ?? null),
            error: pinned
              ? (rows.pinnedStandardError ?? null)
              : (rows.currentStandardError ?? null),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      },
    };
    return query;
  });

  return {
    db: { from } as unknown as SupabaseClient,
    from,
    trace,
  };
}

describe("project-scoped studio resolver runtime", () => {
  it("uses an approved project value, preserves its validated pinned version, and reports drift", async () => {
    const actor = fakeActorClient({
      override: {
        id: overrideId,
        value: "high",
        approved: true,
        standard_version_id: pinnedVersionId,
      },
      currentStandard: {
        id: currentVersionId,
        value: "low",
        version: 2,
      },
      pinnedStandard: {
        id: pinnedVersionId,
        value: "mid",
        version: 1,
      },
    });

    await expect(
      resolveProjectStudioValue(actor.db, {
        projectId,
        standardKey,
        platformDefault: "mid",
        schema: complexitySchema,
      }),
    ).resolves.toEqual({
      projectId,
      standardKey,
      projectOverrideId: overrideId,
      value: "high",
      source: "approved_project_decision",
      studioStandardVersionId: pinnedVersionId,
      drift: {
        type: "standard_drift",
        previousStudioStandardVersionId: pinnedVersionId,
        currentStudioStandardVersionId: currentVersionId,
      },
    });

    expect(actor.trace).toEqual(
      expect.arrayContaining([
        { table: "projects", operation: "eq", args: ["id", projectId] },
        {
          table: "project_overrides",
          operation: "eq",
          args: ["project_id", projectId],
        },
        {
          table: "project_overrides",
          operation: "eq",
          args: ["standard_key", standardKey],
        },
        {
          table: "studio_standards",
          operation: "eq",
          args: ["studio_id", studioId],
        },
        {
          table: "studio_standards",
          operation: "eq",
          args: ["standard_key", standardKey],
        },
        {
          table: "studio_standards",
          operation: "eq",
          args: ["id", pinnedVersionId],
        },
      ]),
    );
    expect(
      actor.trace.some(({ operation }) =>
        ["insert", "update", "upsert", "delete"].includes(operation),
      ),
    ).toBe(false);
  });

  it("uses a project override before the current studio standard", async () => {
    const actor = fakeActorClient({
      override: {
        id: overrideId,
        value: "low",
        approved: false,
        standard_version_id: null,
      },
      currentStandard: {
        id: currentVersionId,
        value: "high",
        version: 4,
      },
    });

    await expect(
      resolveProjectStudioValue(actor.db, {
        projectId,
        standardKey,
        platformDefault: "mid",
        schema: complexitySchema,
      }),
    ).resolves.toMatchObject({
      value: "low",
      source: "project_override",
      studioStandardVersionId: null,
      projectOverrideId: overrideId,
    });
  });

  it("uses the latest versioned studio standard, then the platform default", async () => {
    const withStandard = fakeActorClient({
      currentStandard: {
        id: currentVersionId,
        value: "high",
        version: 7,
      },
    });

    await expect(
      resolveProjectStudioValue(withStandard.db, {
        projectId,
        standardKey,
        platformDefault: "mid",
        schema: complexitySchema,
      }),
    ).resolves.toMatchObject({
      value: "high",
      source: "studio_default",
      studioStandardVersionId: currentVersionId,
      projectOverrideId: null,
    });

    const withoutStandard = fakeActorClient();
    await expect(
      resolveProjectStudioValue(withoutStandard.db, {
        projectId,
        standardKey,
        platformDefault: "mid",
        schema: complexitySchema,
      }),
    ).resolves.toMatchObject({
      value: "mid",
      source: "platform_default",
      studioStandardVersionId: null,
      projectOverrideId: null,
    });
  });

  it("fails closed when RLS does not expose the project", async () => {
    const actor = fakeActorClient({ project: null });

    await expect(
      resolveProjectStudioValue(actor.db, {
        projectId,
        standardKey,
        platformDefault: "mid",
        schema: complexitySchema,
      }),
    ).rejects.toThrow("studio_resolution_project_not_accessible");

    expect(actor.from).toHaveBeenCalledTimes(1);
    expect(actor.from).toHaveBeenCalledWith("projects");
  });

  it("fails closed instead of accepting cross-studio or malformed provenance", async () => {
    const crossStudioPin = fakeActorClient({
      override: {
        id: overrideId,
        value: "high",
        approved: true,
        standard_version_id: pinnedVersionId,
      },
      currentStandard: {
        id: currentVersionId,
        value: "mid",
        version: 2,
      },
      pinnedStandard: null,
    });

    await expect(
      resolveProjectStudioValue(crossStudioPin.db, {
        projectId,
        standardKey,
        platformDefault: "mid",
        schema: complexitySchema,
      }),
    ).rejects.toThrow("studio_resolution_invalid_pinned_standard");

    const malformedApprovedValue = fakeActorClient({
      override: {
        id: overrideId,
        value: "unexpected",
        approved: true,
        standard_version_id: null,
      },
    });
    await expect(
      resolveProjectStudioValue(malformedApprovedValue.db, {
        projectId,
        standardKey,
        platformDefault: "mid",
        schema: complexitySchema,
      }),
    ).rejects.toThrow("studio_resolution_invalid_project_value");
  });
});
