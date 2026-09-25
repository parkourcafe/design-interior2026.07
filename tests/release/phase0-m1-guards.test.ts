import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Фаза 0 (DEC-040, финальный аудит 25.09.2026): публичная ссылка-бриф /b/
// закрыта, бриф не принимается повторно, выданное КП не редактируется и не
// откатывается приложением. Та же граница КП закреплена базой — см.
// tests/db4/79_m1_proposal_lifecycle_guard.sql.

const state = vi.hoisted(() => ({
  projectStatus: "created",
  proposalStatus: "draft",
  projectUpdateMatches: true,
  operations: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/intake", () => ({
  getProjectByIntakeToken: async () => ({
    id: "project", designer_id: "designer", status: state.projectStatus, cellCode: "ru",
  }),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true, clientIp: () => "test" }));
vi.mock("@/lib/brief/pipeline", () => ({
  runRiskPipeline: async () => ({ passport: {}, cards: [], llmOk: true }),
}));

const fakeClient = vi.hoisted(() => () => ({
  schema: () => ({
    rpc: async () => ({
      data: { requests: [{ subjectKind: "project_passport", subjectId: "project", status: "approved" }] },
      error: null,
    }),
  }),
  from: (table: string) => {
    let operation = "select";
    const filters: string[] = [];
    const result = () => {
      state.operations.push(`${table}:${operation}${filters.length ? `[${filters.join(",")}]` : ""}`);
      if (table === "projects" && operation === "update") {
        return { data: state.projectUpdateMatches ? { id: "project" } : null, error: null };
      }
      if (table === "proposals" && operation === "update") {
        return { data: state.proposalStatus === "draft" ? { id: "proposal" } : null, error: null };
      }
      if (table === "projects") return { data: { designer_id: "designer", status: state.projectStatus }, error: null };
      return { data: [], error: null };
    };
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => { filters.push(`${column}=${String(value)}`); return query; },
      in: (column: string, values: unknown[]) => { filters.push(`${column} in ${values.join("|")}`); return query; },
      order: () => query, limit: () => query, maybeSingle: () => query,
      update: () => { operation = "update"; return query; },
      delete: () => { operation = "delete"; return query; },
      upsert: () => { operation = "upsert"; return query; },
      insert: () => { operation = "insert"; return query; },
      then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  },
}));
vi.mock("@/lib/supabase/token-scoped", () => ({ createScopedServiceClient: fakeClient }));
vi.mock("@/lib/supabase/regional-admin", () => ({ createRegionalPublicTokenClient: fakeClient }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeClient() }));
vi.mock("@/lib/studio", () => ({ getStudio: async () => ({ studioId: "designer", designer: {} }) }));
vi.mock("@/lib/proposal/latest", () => ({
  getLatestProposal: async () => ({ id: "proposal", status: state.proposalStatus }),
}));

import { POST as submit } from "../../app/api/intake/submit/route";
import {
  rebuildProposal,
  saveProposal,
  sendProposal,
} from "../../app/dashboard/projects/[id]/proposal/actions";
import { INTAKE_OPEN_STATUSES, isIntakeOpen } from "../../lib/intake-status";

const submitRequest = () => new Request("http://localhost/api/intake/submit", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ token: "token", answers: { q: "a" } }),
});

beforeEach(() => {
  state.projectStatus = "created";
  state.proposalStatus = "draft";
  state.projectUpdateMatches = true;
  state.operations = [];
});

describe("intake submit is accepted only while the brief is open (BUG-02)", () => {
  it("keeps the open-status set explicit", () => {
    expect(INTAKE_OPEN_STATUSES).toEqual(["created", "brief_sent", "brief_in_progress"]);
    for (const status of ["brief_completed", "proposal_draft", "proposal_sent", "proposal_accepted", "active_project"]) {
      expect(isIntakeOpen(status), status).toBe(false);
    }
  });

  it.each(["brief_completed", "proposal_sent", "proposal_accepted", "active_project"])(
    "rejects a resubmission in %s without touching answers or risk cards",
    async (status) => {
      state.projectStatus = status;
      const response = await submit(submitRequest());
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "already_submitted" });
      expect(state.operations).toEqual([]);
    },
  );

  it("transitions the project conditionally and stops before rebuilding risk cards when it lost the race", async () => {
    state.projectUpdateMatches = false;
    const response = await submit(submitRequest());
    expect(response.status).toBe(409);
    const projectUpdate = state.operations.find((op) => op.startsWith("projects:update"));
    expect(projectUpdate).toContain("status in created|brief_sent|brief_in_progress");
    expect(state.operations.some((op) => op.startsWith("risk_cards:"))).toBe(false);
  });

  it("still completes an open brief", async () => {
    const response = await submit(submitRequest());
    expect(response.status).toBe(200);
    expect(state.operations.some((op) => op.startsWith("risk_cards:delete"))).toBe(true);
  });
});

describe("issued proposals are immutable in the application (BUG-03/BUG-04)", () => {
  it.each(["sent", "accepted"])("refuses to save, rebuild or resend a %s proposal", async (status) => {
    state.proposalStatus = status;
    expect(await saveProposal("project", [])).toEqual({ ok: false, reason: "not_draft" });
    expect(await rebuildProposal("project")).toEqual({ ok: false, reason: "sent" });
    expect(await sendProposal("project")).toEqual({ ok: false, reason: "not_draft" });
    expect(state.operations.some((op) => op.startsWith("proposals:update"))).toBe(false);
    expect(state.operations.some((op) => op.startsWith("projects:update"))).toBe(false);
  });

  it("guards every draft write and advances the project only forward", async () => {
    expect(await saveProposal("project", [])).toEqual({ ok: true });
    expect(await sendProposal("project")).toEqual({ ok: true });
    const proposalWrites = state.operations.filter((op) => op.startsWith("proposals:update"));
    expect(proposalWrites.length).toBe(2);
    for (const write of proposalWrites) expect(write).toContain("status=draft");
    const projectWrite = state.operations.find((op) => op.startsWith("projects:update"));
    expect(projectWrite).toContain("status in brief_completed|proposal_draft");
  });
});

describe("public brief link /b/ is closed (DEC-040)", () => {
  const root = process.cwd();

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
  }

  it("has no /b/ route and no component that builds a /b/ link", () => {
    expect(existsSync(join(root, "app/b"))).toBe(false);
    expect(existsSync(join(root, "components/share-brief.tsx"))).toBe(false);
    for (const file of [...sourceFiles(join(root, "app")), ...sourceFiles(join(root, "components"))]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/\/b\/\$\{/);
    }
  });

  it("removes the service-role purpose that served the public brief", () => {
    for (const file of ["lib/supabase/token-scoped.ts", "lib/supabase/regional-admin.ts"]) {
      expect(readFileSync(join(root, file), "utf8"), file).not.toContain("\"public-brief\"");
    }
  });
});
