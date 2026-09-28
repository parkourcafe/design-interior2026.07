import "server-only";

import { createClient } from "@supabase/supabase-js";

import { createScopedServiceClient } from "@/lib/supabase/token-scoped";
import type { PostgresRpcClient } from "@/lib/project-intelligence/adapters/postgres/contracts";
import type { PrivateStorageClient } from "@/lib/project-intelligence/adapters/storage";
import { SecretStoreUnavailableError } from "../core/secret-store";

/**
 * System callback/webhook execution is separate from human request routes.
 * The service-role key is accepted only by this worker boundary and never by
 * human handlers or browser code. The default remains fail-closed.
 */
function createConfiguredAdminClient(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ReturnType<typeof createScopedServiceClient> {
  if (env.REMHAOS_WORKER_TRANSPORT !== "supabase_service_role") {
    throw new SecretStoreUnavailableError("worker_transport_not_configured");
  }
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new SecretStoreUnavailableError("worker_credentials_required");
  }
  return createScopedServiceClient("system-integration-worker");
}

export function createIntegrationWorkerClient(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PostgresRpcClient {
  return createConfiguredAdminClient(env) as unknown as PostgresRpcClient;
}

export function createIntegrationWorkerResources(
  env: Readonly<Record<string, string | undefined>> = process.env,
): { readonly client: PostgresRpcClient; readonly storage: PrivateStorageClient } {
  const admin = createConfiguredAdminClient(env);
  return {
    client: admin as unknown as PostgresRpcClient,
    storage: admin.storage as unknown as PrivateStorageClient,
  };
}

/**
 * DEC-045 (b): клиент загрузчика вложений Telegram под узкой ролью
 * `pi_telegram_file_worker` (только две двери file intake). PostgREST
 * переключается на роль из JWT (`role`); ключ выпускает владелец
 * (docs/canonical/remhaos-v1/REMHAOS_FILE_INTAKE_WORKER_KEY_RUNBOOK.md). Ключ с другой ролью —
 * например, по ошибке положенный service role — отклоняется до первого вызова:
 * воркер не должен тихо работать с правами шире своих.
 */
export function createFileIntakeWorkerClient(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PostgresRpcClient {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const token = env.REMHAOS_FILE_INTAKE_WORKER_JWT;
  if (!url || !publicKey || !token) {
    throw new SecretStoreUnavailableError("file_intake_worker_key_required");
  }
  const claims = fileIntakeWorkerClaims(token);
  if (claims?.role !== FILE_INTAKE_WORKER_ROLE) {
    throw new SecretStoreUnavailableError("file_intake_worker_key_wrong_role");
  }
  // Ключ без срока или с истёкшим сроком не принимается: иначе вложения
  // брались бы в аренду процессом, которому API всё равно откажет.
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) {
    throw new SecretStoreUnavailableError("file_intake_worker_key_expired");
  }
  return createClient(url, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  }) as unknown as PostgresRpcClient;
}

export const FILE_INTAKE_WORKER_ROLE = "pi_telegram_file_worker";

/** Поля JWT без проверки подписи (подпись проверяет PostgREST). */
export function fileIntakeWorkerClaims(token: string): { role?: unknown; exp?: unknown } | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as unknown;
    return payload && typeof payload === "object" ? payload as { role?: unknown; exp?: unknown } : null;
  } catch {
    return null;
  }
}
