import { beforeEach, describe, expect, it, vi } from "vitest";

// Аудит 28.09: лимит частоты — атомарная функция базы, ошибка — отказ.
const state = vi.hoisted(() => ({
  rpc: { data: true as unknown, error: null as null | { code?: string; message: string } },
  legacyCount: 0,
  inserted: [] as unknown[],
  calls: [] as { name: string; args: Record<string, unknown> }[],
}));

vi.mock("@/lib/supabase/token-scoped", () => ({
  createScopedServiceClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.calls.push({ name, args });
      return state.rpc;
    },
    from: () => {
      const query = {
        select: () => query, eq: () => query, gte: () => query,
        insert: async (row: unknown) => { state.inserted.push(row); return { error: null }; },
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ count: state.legacyCount, error: null }).then(resolve),
      };
      return query;
    },
  }),
}));

import { checkRateLimit } from "./rate-limit";

beforeEach(() => {
  state.rpc = { data: true, error: null };
  state.legacyCount = 0;
  state.inserted = [];
  state.calls = [];
});

describe("checkRateLimit", () => {
  it("asks the database to check and count in one call", async () => {
    expect(await checkRateLimit("intake_upload", "1.2.3.4", 40, 3_600_000)).toBe(true);
    expect(state.calls).toEqual([{
      name: "consume_rate_limit",
      args: { p_key: "intake_upload:1.2.3.4", p_window_seconds: 3600, p_max: 40 },
    }]);
  });

  it("refuses when the database says the limit is reached", async () => {
    state.rpc = { data: false, error: null };
    expect(await checkRateLimit("intake_upload", "ip", 1, 1000)).toBe(false);
  });

  it("fails closed on a database error", async () => {
    state.rpc = { data: null, error: { code: "57014", message: "canceling statement" } };
    expect(await checkRateLimit("intake_upload", "ip", 1, 1000)).toBe(false);
  });

  it("keeps the old table check on a database without the function yet", async () => {
    state.rpc = { data: null, error: { code: "PGRST202", message: "function not found" } };
    expect(await checkRateLimit("intake_upload", "ip", 5, 1000)).toBe(true);
    expect(state.inserted).toEqual([{ key: "intake_upload:ip" }]);
    state.legacyCount = 5;
    expect(await checkRateLimit("intake_upload", "ip", 5, 1000)).toBe(false);
  });
});
