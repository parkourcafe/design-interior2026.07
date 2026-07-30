import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
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
  createAdminClient: () => ({
    auth: {
      admin: {
        deleteUser: async (id: string, soft?: boolean) => {
          state.authDeleteCalls.push({ id, soft });
          return { error: null };
        },
      },
    },
    storage: {
      from: () => ({
        list: async (prefix: string) => {
          state.listedPrefixes.push(prefix);
          return {
            data: state.storageEntries[prefix] ?? [{ id: "file-1", name: "file.pdf" }],
            error: null,
          };
        },
        remove: async (paths: string[]) => {
          state.removedFiles.push(...paths);
          return { error: null };
        },
      }),
    },
    from: (table: string) => ({
      select: () => ({
        eq: async (column: string, value: unknown) => {
          state.operations.push({ table, action: "select", column, value });
          return { data: state.projects, error: null };
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
          state.operations.push({ table, action, column, value, values });
          return { error: state.failAction === action ? new Error("controlled") : null };
        },
      }),
    }),
  }),
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
    expect(state.operations).toEqual([]);
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
