import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
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
): ReturnType<typeof createAdminClient> {
  if (env.REMHAOS_WORKER_TRANSPORT !== "supabase_service_role") {
    throw new SecretStoreUnavailableError("worker_transport_not_configured");
  }
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new SecretStoreUnavailableError("worker_credentials_required");
  }
  return createAdminClient();
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
