import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createFileIntakeWorkerClient,
  fileIntakeWorkerClaims,
} from "../../lib/integration-gateway/runtime/worker-client";

// DEC-045 (b): ключ загрузчика вложений — JWT с узкой ролью
// pi_telegram_file_worker и конечным сроком. Подпись проверяет PostgREST;
// здесь — что воркер не стартует с чужим, бессрочным или просроченным ключом
// и что ключ уходит заголовком Authorization.

const jwt = (payload: Record<string, unknown>) =>
  ["e30", Buffer.from(JSON.stringify(payload)).toString("base64url"), "sig"].join(".");
const future = () => Math.floor(Date.now() / 1000) + 3600;

const env = (token: string | undefined) => ({
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.example",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  REMHAOS_FILE_INTAKE_WORKER_JWT: token,
});

describe("file intake worker key", () => {
  it("reads the claims and ignores garbage", () => {
    expect(fileIntakeWorkerClaims(jwt({ role: "pi_telegram_file_worker" }))?.role).toBe("pi_telegram_file_worker");
    expect(fileIntakeWorkerClaims("not-a-jwt")).toBeNull();
    expect(fileIntakeWorkerClaims("a.%%%.c")).toBeNull();
  });

  it("refuses to start without a key", () => {
    expect(() => createFileIntakeWorkerClient(env(undefined))).toThrow("file_intake_worker_key_required");
  });

  it("refuses wider roles put in the worker slot by mistake", () => {
    for (const role of ["service_role", "pi_worker_executor", "authenticated"]) {
      expect(() => createFileIntakeWorkerClient(env(jwt({ role, exp: future() }))), role)
        .toThrow("file_intake_worker_key_wrong_role");
    }
  });

  it("refuses a key without expiry or already expired", () => {
    expect(() => createFileIntakeWorkerClient(env(jwt({ role: "pi_telegram_file_worker" }))))
      .toThrow("file_intake_worker_key_expired");
    expect(() => createFileIntakeWorkerClient(env(jwt({ role: "pi_telegram_file_worker", exp: 1_000 }))))
      .toThrow("file_intake_worker_key_expired");
  });

  it("sends the worker key as the bearer token, not the publishable key", async () => {
    const token = jwt({ role: "pi_telegram_file_worker", exp: future() });
    const seen: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get("authorization") ?? "");
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const client = createFileIntakeWorkerClient(env(token));
      await client.schema("remhaos_integration_api").rpc("create_file_intake_worker", {});
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(seen).toEqual([`Bearer ${token}`]);
  });
});
