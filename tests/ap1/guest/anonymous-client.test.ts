import { expect, it, vi } from "vitest";

const supabaseMock = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: supabaseMock.createClient,
}));

function makeRpcClient(envelope: unknown) {
  const rpc = vi.fn().mockResolvedValue({ data: envelope, error: null });
  const schema = vi.fn().mockReturnValue({ rpc });
  const getSession = vi.fn(() => {
    throw new Error("guest reads must not inherit an auth session");
  });
  const setSession = vi.fn(() => {
    throw new Error("guest reads must not set an auth session");
  });

  return {
    client: {
      auth: { getSession, setSession },
      schema,
    },
    getSession,
    rpc,
    schema,
    setSession,
  };
}

async function expectControlledInternalError(
  run: () => unknown | Promise<unknown>,
): Promise<void> {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(Error);
  expect(caught).toMatchObject({ code: "internal_error" });
}

it("creates isolated anonymous guest clients, prefers public credentials, and fails closed without public configuration", async () => {
  supabaseMock.createClient.mockReset();
  const {
    createProjectCeoGuestRpcClient,
    readProjectCeoGuestRelease,
  } = await import(
    "@/lib/project-intelligence/delivery/projectceo/guest-link"
  );

  expect(supabaseMock.createClient).not.toHaveBeenCalled();

  const canonicalToken =
    "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
  const expectedTokenDigest =
    "\\x630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd";
  const publicUrl = "https://project-ref.supabase.co";
  const publishableKey = "sb_publishable_archidom_guest";
  const anonKey = "eyJ-anon-public-fallback";
  const traps = {
    admin: "admin-key-trap-must-never-be-used",
    cookie: "authenticated-cookie-trap-must-never-be-used",
    identity: "inherited-user-jwt-trap-must-never-be-used",
    serviceRole: "service-role-trap-must-never-be-used",
  };
  const expectedClientOptions = {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  };
  const projection = {
    allowAcknowledgement: true,
    expiresAt: "2026-08-18T12:34:56.000Z",
    package: {
      id: "0f97565d-7a63-4db0-9f61-d3be78e77207",
      kind: "work_package",
      name: "Kora · Рабочий пакет 01",
      stableKey: "kora-work-package-01",
    },
    projectId: "2ddf531b-6bc8-457d-bcc6-36f4651259ea",
    release: {
      graphDigest:
        "sha256:a3b91d763e80aeaa0c6cd8ff2e6b9f0365b58b7f7a50a77ae179e53ab8f108c4",
      publishedAt: "2026-07-18T08:15:30.000Z",
      versionId: "909fe699-aef9-4ec7-9774-63c4d23bf782",
      versionNo: 3,
    },
  };
  const envelope = {
    contractVersion: "project-ceo-foundation/0.1",
    requestId: "b92a9139-715c-4b81-a5da-ab154318a6d3",
    data: projection,
    error: null,
  };

  const publishableFactoryClient = makeRpcClient(envelope);
  supabaseMock.createClient.mockReturnValueOnce(
    publishableFactoryClient.client,
  );
  const createdWithPublishableKey = createProjectCeoGuestRpcClient({
    NODE_ENV: "test",
    NEXT_PUBLIC_SUPABASE_URL: publicUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: traps.serviceRole,
    SUPABASE_ADMIN_KEY: traps.admin,
    AUTH_COOKIE: traps.cookie,
    SUPABASE_AUTH_TOKEN: traps.identity,
  } as NodeJS.ProcessEnv);

  expect(createdWithPublishableKey).toBe(publishableFactoryClient.client);
  expect(supabaseMock.createClient).toHaveBeenNthCalledWith(
    1,
    publicUrl,
    publishableKey,
    expectedClientOptions,
  );
  expect(publishableFactoryClient.schema).not.toHaveBeenCalled();
  expect(publishableFactoryClient.rpc).not.toHaveBeenCalled();

  const anonFactoryClient = makeRpcClient(envelope);
  supabaseMock.createClient.mockReturnValueOnce(anonFactoryClient.client);
  const createdWithAnonFallback = createProjectCeoGuestRpcClient({
    NODE_ENV: "test",
    NEXT_PUBLIC_SUPABASE_URL: publicUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: traps.serviceRole,
    SUPABASE_ADMIN_KEY: traps.admin,
    AUTH_COOKIE: traps.cookie,
    SUPABASE_AUTH_TOKEN: traps.identity,
  } as NodeJS.ProcessEnv);

  expect(createdWithAnonFallback).toBe(anonFactoryClient.client);
  expect(supabaseMock.createClient).toHaveBeenNthCalledWith(
    2,
    publicUrl,
    anonKey,
    expectedClientOptions,
  );
  expect(anonFactoryClient.schema).not.toHaveBeenCalled();
  expect(anonFactoryClient.rpc).not.toHaveBeenCalled();

  try {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", publicUrl);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", publishableKey);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", anonKey);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", traps.serviceRole);
    vi.stubEnv("SUPABASE_ADMIN_KEY", traps.admin);
    vi.stubEnv("AUTH_COOKIE", traps.cookie);
    vi.stubEnv("SUPABASE_AUTH_TOKEN", traps.identity);

    const firstDefaultClient = makeRpcClient(envelope);
    const secondDefaultClient = makeRpcClient(envelope);
    supabaseMock.createClient
      .mockReturnValueOnce(firstDefaultClient.client)
      .mockReturnValueOnce(secondDefaultClient.client);

    await expect(readProjectCeoGuestRelease(canonicalToken)).resolves.toEqual(
      projection,
    );
    await expect(readProjectCeoGuestRelease(canonicalToken)).resolves.toEqual(
      projection,
    );

    expect(supabaseMock.createClient).toHaveBeenNthCalledWith(
      3,
      publicUrl,
      publishableKey,
      expectedClientOptions,
    );
    expect(supabaseMock.createClient).toHaveBeenNthCalledWith(
      4,
      publicUrl,
      publishableKey,
      expectedClientOptions,
    );
    expect(firstDefaultClient.client).not.toBe(secondDefaultClient.client);

    for (const rpcClient of [firstDefaultClient, secondDefaultClient]) {
      expect(rpcClient.schema).toHaveBeenCalledTimes(1);
      expect(rpcClient.schema).toHaveBeenCalledWith("projectceo_api");
      expect(rpcClient.rpc).toHaveBeenCalledTimes(1);
      expect(rpcClient.rpc).toHaveBeenCalledWith("read_guest_release", {
        token_digest: expectedTokenDigest,
      });
      expect(rpcClient.getSession).not.toHaveBeenCalled();
      expect(rpcClient.setSession).not.toHaveBeenCalled();
    }

    const serializedClientCalls = JSON.stringify(
      supabaseMock.createClient.mock.calls,
    );
    for (const trap of Object.values(traps)) {
      expect(serializedClientCalls).not.toContain(trap);
    }

    const callsBeforeMissingConfig = supabaseMock.createClient.mock.calls.length;
    for (const missingEnvironment of [
      {
        NODE_ENV: "test",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
        SUPABASE_SERVICE_ROLE_KEY: traps.serviceRole,
      },
      {
        NODE_ENV: "test",
        NEXT_PUBLIC_SUPABASE_URL: publicUrl,
        SUPABASE_SERVICE_ROLE_KEY: traps.serviceRole,
        SUPABASE_ADMIN_KEY: traps.admin,
      },
    ] as NodeJS.ProcessEnv[]) {
      await expectControlledInternalError(() =>
        createProjectCeoGuestRpcClient(missingEnvironment),
      );
    }
    expect(supabaseMock.createClient).toHaveBeenCalledTimes(
      callsBeforeMissingConfig,
    );

    for (const missingPublicConfig of [
      { url: "", publishableKey, anonKey },
      { url: publicUrl, publishableKey: "", anonKey: "" },
    ]) {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", missingPublicConfig.url);
      vi.stubEnv(
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        missingPublicConfig.publishableKey,
      );
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", missingPublicConfig.anonKey);
      await expectControlledInternalError(() =>
        readProjectCeoGuestRelease(canonicalToken),
      );
    }

    expect(supabaseMock.createClient).toHaveBeenCalledTimes(
      callsBeforeMissingConfig,
    );
    expect(publishableFactoryClient.rpc).not.toHaveBeenCalled();
    expect(anonFactoryClient.rpc).not.toHaveBeenCalled();
    expect(firstDefaultClient.rpc).toHaveBeenCalledTimes(1);
    expect(secondDefaultClient.rpc).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllEnvs();
  }
});
