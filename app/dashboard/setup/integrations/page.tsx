import Link from "next/link";
import { notFound } from "next/navigation";
import { IntegrationsSettingsPanel } from "@/components/integration-gateway/integrations-settings-panel";
import { IntegrationConnectionService } from "@/lib/integration-gateway/registry/connection-service";
import { requireIntegrationOwner } from "@/lib/integration-gateway/registry/access";
import type { IntegrationProviderDescriptor } from "@/lib/integration-gateway/registry/provider-registry";
import { createProjectCeoRequestContext } from "@/lib/project-intelligence/delivery/projectceo/request-context";
import { ru } from "@/lib/i18n/ru";

export const dynamic = "force-dynamic";

export default async function IntegrationsSettingsPage() {
  const enabled = process.env.REMHAOS_INTEGRATIONS_ENABLED === "true";
  let providers: IntegrationProviderDescriptor[] = [];
  let connections: Awaited<ReturnType<IntegrationConnectionService["listOrganizationConnections"]>> = [];
  let organizationId: string | null = null;
  if (enabled) {
    try {
      const portfolio = await requireIntegrationOwner();
      organizationId = portfolio.organization.id;
      const context = await createProjectCeoRequestContext();
      const service = new IntegrationConnectionService(context.client);
      [providers, connections] = await Promise.all([
        service.listProviders(),
        service.listOrganizationConnections(organizationId),
      ]);
    } catch {
      notFound();
    }
  }
  return (
    <div className="space-y-5">
      <Link href="/dashboard/setup" className="text-sm text-muted hover:text-ink">
        ← {ru.nav.setup}
      </Link>
      <IntegrationsSettingsPanel
        providers={providers}
        connections={connections}
        organizationId={organizationId}
        enabled={enabled}
      />
    </div>
  );
}
