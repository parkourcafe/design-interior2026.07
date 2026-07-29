import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveProjectStudioValue: vi.fn(),
}));

vi.mock("./studio-resolver-runtime", () => ({
  resolveProjectStudioValue: mocks.resolveProjectStudioValue,
}));

import { resolveM1ProposalComplexity } from "./proposal-studio-decisions";

const projectId = "00000000-0000-4000-8000-000000000101";

describe("M1 proposal studio decisions", () => {
  it("resolves proposal complexity through the project-scoped runtime contract", async () => {
    const db = { from: vi.fn() } as unknown as SupabaseClient;
    const resolution = {
      projectId,
      standardKey: "proposal.complexity",
      projectOverrideId: null,
      value: "high" as const,
      source: "studio_default" as const,
      studioStandardVersionId:
        "00000000-0000-4000-8000-000000000402",
      drift: null,
    };
    mocks.resolveProjectStudioValue.mockResolvedValueOnce(resolution);

    await expect(resolveM1ProposalComplexity(db, projectId)).resolves.toBe(
      resolution,
    );
    expect(mocks.resolveProjectStudioValue).toHaveBeenCalledOnce();
    const [actorClient, input] =
      mocks.resolveProjectStudioValue.mock.calls[0] as [
        SupabaseClient,
        {
          projectId: string;
          standardKey: string;
          platformDefault: string;
          schema: { safeParse(value: unknown): { success: boolean } };
        },
      ];
    expect(actorClient).toBe(db);
    expect(input).toMatchObject({
      projectId,
      standardKey: "proposal.complexity",
      platformDefault: "mid",
    });
    expect(input.schema.safeParse("low").success).toBe(true);
    expect(input.schema.safeParse("unexpected").success).toBe(false);
  });

  it("is wired into the real proposal pricing decision instead of leaving the hardcoded value", () => {
    const proposalPage = readFileSync(
      resolve(
        process.cwd(),
        "app/dashboard/projects/[id]/proposal/page.tsx",
      ),
      "utf8",
    );
    const proposalActions = readFileSync(
      resolve(
        process.cwd(),
        "app/dashboard/projects/[id]/proposal/actions.ts",
      ),
      "utf8",
    );

    expect(proposalPage).toMatch(
      /await\s+resolveM1ProposalComplexity\s*\(\s*supabase\s*,\s*p\.id\s*\)/,
    );
    expect(proposalPage).toMatch(
      /complexity\s*:\s*proposalComplexity\.value/,
    );
    expect(proposalPage).not.toMatch(/complexity\s*:\s*["']mid["']/);
    expect(proposalActions).toMatch(
      /await\s+resolveM1ProposalComplexity\s*\(\s*supabase\s*,\s*projectId\s*,?\s*\)/,
    );
    expect(proposalActions).toMatch(
      /complexity\s*:\s*proposalComplexity\.value/,
    );
    expect(proposalActions).not.toMatch(/complexity\s*:\s*["']mid["']/);
  });
});
