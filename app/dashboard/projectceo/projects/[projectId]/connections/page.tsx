import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectConnectionsPanel } from "@/components/integration-gateway/project-connections-panel";
import {
  IntegrationConnectionService,
  projectConnectionProjectionSchema,
} from "@/lib/integration-gateway/registry/connection-service";
import type { z } from "zod";
import type { IntegrationProviderDescriptor } from "@/lib/integration-gateway/registry/provider-registry";
import { createProjectCeoRequestContext } from "@/lib/project-intelligence/delivery/projectceo/request-context";
import { createProjectCeoServerPort } from "@/lib/project-intelligence/delivery/projectceo/server-port";
import { ru } from "@/lib/i18n/ru";

export const dynamic = "force-dynamic";

export default async function ProjectConnectionsPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  if (process.env.REMHAOS_INTEGRATIONS_ENABLED !== "true") {
    return (
      <section className="space-y-4">
        <Link href={`/dashboard/projectceo/projects/${projectId}`} className="text-sm text-muted hover:text-ink">
          ← {ru.projectCeo.actions.open}
        </Link>
        <h1 className="font-display text-3xl font-semibold">{ru.projectConnections.title}</h1>
        <p className="text-sm text-muted">{ru.integrations.disabled}</p>
      </section>
    );
  }
  let connections: z.infer<typeof projectConnectionProjectionSchema>[] = [];
  let availableConnections: Awaited<ReturnType<IntegrationConnectionService["listOrganizationConnections"]>> = [];
  let providers: IntegrationProviderDescriptor[] = [];
  let canManage = false;
  try {
    const requestContext = await createProjectCeoRequestContext();
    const service = new IntegrationConnectionService(requestContext.client);
    const port = await createProjectCeoServerPort();
    const workspace = await port.getProjectWorkspace({
      projectId,
      requestId: crypto.randomUUID(),
    });
    if (!workspace.data || workspace.error) notFound();
    canManage = workspace.data.actor.role === "owner";
    connections = await service.listTeamProjectConnections(projectId);
    if (canManage) {
      [availableConnections, providers] = await Promise.all([
        service.listOrganizationConnections(workspace.data.project.organizationId),
        service.listProviders(),
      ]);
    }
  } catch {
    notFound();
  }
  return (
    <div className="space-y-5">
      <Link href={`/dashboard/projectceo/projects/${projectId}`} className="text-sm text-muted hover:text-ink">
        ← {ru.projectCeo.actions.open}
      </Link>
      <ProjectConnectionsPanel
        projectId={projectId}
        connections={connections}
        availableConnections={availableConnections}
        providers={providers}
        canManage={canManage}
      />
    </div>
  );
}
