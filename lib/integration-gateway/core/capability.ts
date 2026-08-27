import { z } from "zod";

export const INTEGRATION_PROVIDER_CODES = [
  "google_drive",
  "telegram",
  "url_reference",
] as const;

export const INTEGRATION_CAPABILITIES = [
  "list_objects",
  "import_object",
  "receive_webhook",
  "send_notification",
  "export_published_artifact",
] as const;

export const CONNECTOR_STATUSES = [
  "connected",
  "degraded",
  "reauth_required",
  "disconnected",
] as const;

export const providerCodeSchema = z.enum(INTEGRATION_PROVIDER_CODES);
export const integrationCapabilitySchema = z.enum(INTEGRATION_CAPABILITIES);
export const connectorStatusSchema = z.enum(CONNECTOR_STATUSES);

export type IntegrationProviderCode = z.infer<typeof providerCodeSchema>;
export type IntegrationCapability = z.infer<typeof integrationCapabilitySchema>;
export type ConnectorStatus = z.infer<typeof connectorStatusSchema>;

export function assertIntegrationCapabilities(
  values: readonly string[],
): readonly IntegrationCapability[] {
  return z.array(integrationCapabilitySchema).nonempty().parse(values);
}
