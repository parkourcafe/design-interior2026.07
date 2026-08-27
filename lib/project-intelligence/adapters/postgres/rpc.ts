import type { PostgresRpcClient } from "./contracts";
import { mapRpcError } from "./errors";

export async function callRpc(
  client: PostgresRpcClient,
  schemaName:
    | "projectceo_api"
    | "projectceo_m4_api"
    | "projectceo_read_api"
    | "project_intelligence_api"
    | "remhaos_integration_api",
  functionName: string,
  args: Readonly<Record<string, unknown>> = {},
): Promise<unknown> {
  const { data, error } = await client.schema(schemaName).rpc(functionName, args);
  if (error) {
    throw mapRpcError(error);
  }
  return data;
}
