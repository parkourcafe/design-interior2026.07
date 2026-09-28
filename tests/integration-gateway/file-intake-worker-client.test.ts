import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createFileIntakeWorkerClient,
  fileIntakeWorkerRole,
} from "../../lib/integration-gateway/runtime/worker-client";

// DEC-045 (b): ключ воркера file intake — JWT с ролью pi_worker_executor.
// Подпись проверяет PostgREST; здесь — только что воркер не стартует с
// чужим или отсутствующим ключом.

const jwt = (payload: Record<string, unknown>) =>
  ["e30", Buffer.from(JSON.stringify(payload)).toString("base64url"), "sig"].join(".");

const env = (token: string | undefined) => ({
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.example",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  REMHAOS_FILE_INTAKE_WORKER_JWT: token,
});

describe("file intake worker key", () => {
  it("reads the role claim", () => {
    expect(fileIntakeWorkerRole(jwt({ role: "pi_worker_executor" }))).toBe("pi_worker_executor");
    expect(fileIntakeWorkerRole("not-a-jwt")).toBeNull();
    expect(fileIntakeWorkerRole("a.%%%.c")).toBeNull();
  });

  it("refuses to start without a key", () => {
    expect(() => createFileIntakeWorkerClient(env(undefined))).toThrow("file_intake_worker_key_required");
  });

  it("refuses a service_role key put in the worker slot by mistake", () => {
    expect(() => createFileIntakeWorkerClient(env(jwt({ role: "service_role" }))))
      .toThrow("file_intake_worker_key_wrong_role");
  });

  it("builds a client for a pi_worker_executor key", () => {
    const client = createFileIntakeWorkerClient(env(jwt({ role: "pi_worker_executor" })));
    expect(typeof client.schema).toBe("function");
  });
});
