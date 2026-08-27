import { z } from "zod";
import {
  integrationCapabilitySchema,
  providerCodeSchema,
} from "../core/capability";

export const integrationProviderDescriptorSchema = z.object({
  providerCode: providerCodeSchema,
  displayNameKey: z.string().min(1),
  connectionMode: z.enum([
    "link_only",
    "oauth",
    "native",
    "webhook",
    "file_import",
  ]),
  capabilities: z.object({
    capabilities: z.array(integrationCapabilitySchema),
  }),
  legalState: z.enum(["allowed", "staging_only", "blocked"]),
  defaultEnabled: z.boolean(),
});

export type IntegrationProviderDescriptor = z.infer<
  typeof integrationProviderDescriptorSchema
>;

export const integrationProviderListSchema = z.array(
  integrationProviderDescriptorSchema,
);
