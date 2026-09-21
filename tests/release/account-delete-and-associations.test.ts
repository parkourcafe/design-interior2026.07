import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  adminCalls: 0,
  sequence: [] as string[],
  listCalls: [] as Array<{ prefix: string; offset: number }>,
  user: { id: "user-1" } as { id: string } | null,
  projects: [{ id: "project-1" }],
  operations: [] as Array<{ table: string; action: string; column?: string; value?: unknown; values?: unknown }>,
  listedPrefixes: [] as string[],
  storageEntries: {} as Record<string, Array<{ id: string | null; name: string }>>,
  removedFiles: [] as string[],
  authDeleteCalls: [] as Array<{ id: string; soft: boolean | undefined }>,
  failAction: "" as string,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user } }),
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    state.adminCalls += 1;
    return ({
    auth: {
      admin: {
        deleteUser: async (id: string, soft?: boolean) => {
          state.sequence.push("auth-delete");
          state.authDeleteCalls.push({ id, soft });
          return { error: null };
        },
      },
    },
    storage: {
      from: () => ({
        list: async (prefix: string, options: { offset: number; limit: number }) => {
          state.listedPrefixes.push(prefix);
          state.listCalls.push({ prefix, offset: options.offset });
          return {
            data: (state.storageEntries[prefix] ?? [{ id: "file-1", name: "file.pdf" }]).slice(options.offset, options.offset + options.limit),
            error: state.failAction === "list" ? new Error("controlled") : null,
          };
        },
        remove: async (paths: string[]) => {
          state.sequence.push("storage-remove");
          state.removedFiles.push(...paths);
          return { error: state.failAction === "remove" ? new Error("controlled") : null };
        },
      }),
    },
    from: (table: string) => ({
      select: () => ({
        eq: async (column: string, value: unknown) => {
          state.operations.push({ table, action: "select", column, value });
          return { data: state.projects, error: state.failAction === "select" ? new Error("controlled") : null };
        },
      }),
      delete: () => ({
        eq: async (column: string, value: unknown) => {
          const action = `delete:${table}`;
          state.operations.push({ table, action, column, value });
          return { error: state.failAction === action ? new Error("controlled") : null };
        },
        in: async (column: string, value: unknown) => {
          const action = `delete:${table}`;
          state.operations.push({ table, action, column, value });
          return { error: state.failAction === action ? new Error("controlled") : null };
        },
      }),
      update: (values: unknown) => ({
        eq: async (column: string, value: unknown) => {
          const action = `update:${table}`;
          state.sequence.push(action);
          state.operations.push({ table, action, column, value, values });
          return { error: state.failAction === action ? new Error("controlled") : null };
        },
      }),
    }),
  });
  },
}));

import { DELETE as deleteAccount } from "../../app/api/account/delete/route";
import { GET as getAasa } from "../../app/api/apple-app-site-association/route";
import { GET as getAssetLinks } from "../../app/api/assetlinks/route";

function deleteRequest(confirmation: string) {
  return new Request("https://www.arhidom.space/api/account/delete", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmation }),
  });
}

describe("release account deletion", () => {
  beforeEach(() => {
    state.adminCalls = 0;
    state.sequence = [];
    state.listCalls = [];
    state.user = { id: "user-1" };
    state.projects = [{ id: "project-1" }];
    state.operations = [];
    state.listedPrefixes = [];
    state.storageEntries = {};
    state.removedFiles = [];
    state.authDeleteCalls = [];
    state.failAction = "";
  });

  it("requires explicit confirmation before changing data", async () => {
    const response = await deleteAccount(deleteRequest("delete"));

    expect(response.status).toBe(400);
    expect(state.adminCalls).toBe(0);
    expect(state.operations).toEqual([]);
    expect(state.authDeleteCalls).toEqual([]);
  });

  it("rejects unauthenticated deletion before creating an admin client", async () => {
    state.user = null;
    const response = await deleteAccount(deleteRequest("УДАЛИТЬ"));
    expect(response.status).toBe(401);
    expect(state.adminCalls).toBe(0);
    expect(state.operations).toEqual([]);
    expect(state.authDeleteCalls).toEqual([]);
  });

  it("scopes cleanup to owned projects and completes it before closing Auth", async () => {
    state.projects = [{ id: "owned-a" }, { id: "owned-b" }];
    const response = await deleteAccount(deleteRequest("УДАЛИТЬ"));
    expect(response.status).toBe(200);
    expect(state.operations[0]).toEqual({ table: "projects", action: "select", column: "designer_id", value: "user-1" });
    expect(state.listedPrefixes).toEqual(["owned-a", "designer-plans/owned-a", "owned-b", "designer-plans/owned-b"]);
    for (const table of ["project_rooms", "answers", "risk_cards", "proposals"]) {
      expect(state.operations).toContainEqual({ table, action: `delete:${table}`, column: "project_id", value: ["owned-a", "owned-b"] });
    }
    expect(state.operations.filter((op) => op.action === "update:projects").map((op) => op.value)).toEqual(["owned-a", "owned-b"]);
    expect(state.operations).toContainEqual({ table: "project_participants", action: "update:project_participants", column: "auth_user_id", value: "user-1", values: { display_name: "", access_token: null, auth_user_id: null } });
    expect(state.sequence[0]).toBe("storage-remove");
    expect(state.sequence.slice(-2)).toEqual(["update:designers", "auth-delete"]);
  });

  it("paginates full listings and traverses nested folders without deleting folder names", async () => {
    state.storageEntries = {
      "project-1": [...Array.from({ length: 100 }, (_, i) => ({ id: `file-${i}`, name: `${i}.pdf` })), { id: null, name: "nested" }],
      "project-1/nested": [{ id: "nested-file", name: "last.pdf" }],
      "designer-plans/project-1": [],
    };
    const response = await deleteAccount(deleteRequest("УДАЛИТЬ"));
    expect(response.status).toBe(200);
    expect(state.listCalls).toContainEqual({ prefix: "project-1", offset: 100 });
    expect(state.removedFiles).toHaveLength(101);
    expect(new Set(state.removedFiles).size).toBe(101);
    expect(state.removedFiles).toContain("project-1/nested/last.pdf");
    expect(state.removedFiles).not.toContain("project-1/nested");
  });

  it.each(["select", "list", "remove", "delete:answers", "update:designers"])("does not close Auth after %s failure", async (failure) => {
    state.failAction = failure;
    const response = await deleteAccount(deleteRequest("УДАЛИТЬ"));
    expect(response.status).toBe(500);
    expect(state.authDeleteCalls).toEqual([]);
  });

  it("removes editable content, revokes tokens and soft-deletes Supabase Auth", async () => {
    const response = await deleteAccount(deleteRequest("УДАЛИТЬ"));

    expect(response.status).toBe(200);
    expect(state.listedPrefixes).toEqual(["project-1", "designer-plans/project-1"]);
    expect(state.removedFiles).toEqual([
      "project-1/file.pdf",
      "designer-plans/project-1/file.pdf",
    ]);
    expect(state.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: "studio_members", action: "delete:studio_members", column: "member_id" }),
      expect.objectContaining({ table: "studio_members", action: "delete:studio_members", column: "owner_id" }),
      expect.objectContaining({ table: "project_rooms", action: "delete:project_rooms" }),
      expect.objectContaining({ table: "answers", action: "delete:answers" }),
      expect.objectContaining({ table: "risk_cards", action: "delete:risk_cards" }),
      expect.objectContaining({ table: "proposals", action: "delete:proposals" }),
      expect.objectContaining({
        table: "designers",
        action: "update:designers",
        values: { name: "", studio_name: "", pricing: null, proposal_defaults: {}, profile: {} },
      }),
    ]));

    const projectUpdate = state.operations.find((operation) => operation.action === "update:projects");
    expect(projectUpdate?.values).toMatchObject({
      client_name: "",
      passport: null,
      custom_questions: [],
    });
    expect((projectUpdate?.values as { intake_token: string }).intake_token).not.toBe("");
    expect(state.authDeleteCalls).toEqual([{ id: "user-1", soft: true }]);
  });

  it("recursively removes files below both known project prefixes", async () => {
    state.storageEntries = {
      "project-1": [{ id: null, name: "nested" }],
      "project-1/nested": [{ id: "file-1", name: "brief.pdf" }],
      "designer-plans/project-1": [{ id: null, name: "revisions" }],
      "designer-plans/project-1/revisions": [{ id: "file-2", name: "plan.pdf" }],
    };

    const response = await deleteAccount(deleteRequest("УДАЛИТЬ"));

    expect(response.status).toBe(200);
    expect(state.removedFiles).toEqual([
      "project-1/nested/brief.pdf",
      "designer-plans/project-1/revisions/plan.pdf",
    ]);
  });

  it("does not close Auth when data anonymization fails", async () => {
    state.failAction = "update:projects";

    const response = await deleteAccount(deleteRequest("УДАЛИТЬ"));

    expect(response.status).toBe(500);
    expect(state.authDeleteCalls).toEqual([]);
  });
});

describe("store association documents", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("publishes the iOS app entry and authenticated routes for the configured App ID", async () => {
    vi.stubEnv("APPLE_TEAM_ID", "TEAM123456");
    const response = await getAasa();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.applinks.details[0].appIDs).toEqual(["TEAM123456.space.arhidom.ios"]);
    expect(body.applinks.details[0].components).toEqual(expect.arrayContaining([
      expect.objectContaining({ "/": "/app*" }),
      expect.objectContaining({ "/": "/dashboard*" }),
      expect.objectContaining({ "/": "/projectceo/*" }),
    ]));
  });

  it("publishes only valid Android SHA-256 fingerprints", async () => {
    const valid = Array.from({ length: 32 }, () => "ab").join(":");
    vi.stubEnv("ANDROID_PACKAGE_NAME", "space.arhidom.twa");
    vi.stubEnv("ANDROID_CERT_SHA256", `${valid},not-a-certificate`);

    const response = getAssetLinks();
    const body = await response.json();

    expect(body).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "space.arhidom.twa",
          sha256_cert_fingerprints: [valid.toUpperCase()],
        },
      },
    ]);
  });
});
