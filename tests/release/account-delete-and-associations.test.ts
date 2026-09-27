import { beforeEach, describe, expect, it, vi } from "vitest";

// DEC-040, DEC-041 §2, DEC-044 (a): удаление аккаунта — заявка с 90-дневным
// сроком «только для чтения», а не мгновенное стирание. Маршрут не берёт
// сервисный ключ, ничего не удаляет и не закрывает вход; заявку создаёт база
// от имени самого дизайнера (DB4 84 проверяет саму заявку и «только чтение»).

const state = vi.hoisted(() => ({
  adminCalls: 0,
  user: { id: "user-1" } as { id: string } | null,
  rpcCalls: [] as Array<{ name: string; args: unknown }>,
  rpcResult: { data: { status: "requested", purgeAfter: "2026-12-27T10:00:00.000Z", replay: false }, error: null } as
    { data: unknown; error: unknown },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user } }),
    },
    rpc: async (name: string, args: unknown) => {
      state.rpcCalls.push({ name, args });
      return state.rpcResult;
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    state.adminCalls += 1;
    throw new Error("account deletion must not use the service role");
  },
}));

import { readFileSync } from "node:fs";
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

describe("release account deletion (90-day read-only retention)", () => {
  beforeEach(() => {
    state.adminCalls = 0;
    state.user = { id: "user-1" };
    state.rpcCalls = [];
    state.rpcResult = { data: { status: "requested", purgeAfter: "2026-12-27T10:00:00.000Z", replay: false }, error: null };
  });

  it("requires explicit confirmation before requesting deletion", async () => {
    const response = await deleteAccount(deleteRequest("нет"));
    expect(response.status).toBe(400);
    expect(state.rpcCalls).toEqual([]);
  });

  it("rejects unauthenticated deletion", async () => {
    state.user = null;
    const response = await deleteAccount(deleteRequest("УДАЛИТЬ"));
    expect(response.status).toBe(401);
    expect(state.rpcCalls).toEqual([]);
  });

  it("opens a retention case as the designer and returns the purge date", async () => {
    const response = await deleteAccount(deleteRequest("УДАЛИТЬ"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, purgeAfter: "2026-12-27T10:00:00.000Z", replay: false });
    expect(state.rpcCalls).toEqual([{ name: "request_account_deletion", args: { p_reason: null } }]);
    expect(state.adminCalls).toBe(0);
  });

  it("reports a failure without pretending the case exists", async () => {
    state.rpcResult = { data: null, error: { message: "controlled" } };
    const response = await deleteAccount(deleteRequest("УДАЛИТЬ"));
    expect(response.status).toBe(500);
  });

  it("no longer deletes data, storage files or the Auth user", () => {
    const source = readFileSync("app/api/account/delete/route.ts", "utf8");
    for (const forbidden of [".delete(", ".remove(", "deleteUser", "createScopedServiceClient", "createAdminClient"]) {
      expect(source).not.toContain(forbidden);
    }
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
