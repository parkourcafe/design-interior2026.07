import { describe, expect, it, vi } from "vitest";
import {
  FailClosedSecretStore,
  MemorySecretStore,
  createSecretStoreFromEnv,
} from "./secret-store";

describe("Integration Gateway SecretStore boundary", () => {
  it("fails closed unless an explicit non-production adapter is selected", async () => {
    await expect(new FailClosedSecretStore().get("selection:google-drive:test")).rejects.toThrow(
      "secret_store_not_configured",
    );
    expect(createSecretStoreFromEnv({ NODE_ENV: "production", REMHAOS_SECRET_STORE_ADAPTER: "memory" }))
      .toBeInstanceOf(FailClosedSecretStore);
  });

  it("supports expiring process-local records without exposing them in a return DTO", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T00:00:00.000Z"));
    const store = new MemorySecretStore();
    await store.put({
      ref: "selection:google-drive:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      value: { opaque_value: "provider-object", display_name: "plan.pdf" },
      expiresAt: "2026-08-27T00:01:00.000Z",
    });
    expect(await store.get("selection:google-drive:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"))
      .toMatchObject({ value: { opaque_value: "provider-object" } });
    vi.setSystemTime(new Date("2026-08-27T00:02:00.000Z"));
    await expect(store.get("selection:google-drive:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"))
      .resolves.toBeNull();
    vi.useRealTimers();
  });
});
