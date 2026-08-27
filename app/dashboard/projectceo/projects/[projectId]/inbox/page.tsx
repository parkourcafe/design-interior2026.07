import Link from "next/link";
import { ProjectInboxPanel } from "@/components/integration-gateway/project-inbox-panel";
import { FileIntakeService } from "@/lib/integration-gateway/file-intake/service";
import { ProjectLinkService } from "@/lib/integration-gateway/links/project-link-service";
import { IntegrationConnectionService } from "@/lib/integration-gateway/registry/connection-service";
import { TelegramBridgeService } from "@/lib/integration-gateway/telegram/service";
import { createProjectCeoRequestContext } from "@/lib/project-intelligence/delivery/projectceo/request-context";
import { ru } from "@/lib/i18n/ru";

export const dynamic = "force-dynamic";

export default async function ProjectInboxPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const requestContext = await createProjectCeoRequestContext();
  const linksEnabled = process.env.REMHAOS_PROJECT_LINKS_ENABLED === "true";
  const fileIntakeEnabled = process.env.REMHAOS_FILE_INTAKE_ENABLED === "true";
  const telegramEnabled = process.env.REMHAOS_TELEGRAM_BRIDGE_ENABLED === "true";
  const integrationEnabled = process.env.REMHAOS_INTEGRATIONS_ENABLED === "true";
  const [links, files, telegramCandidates, importCandidates] = await Promise.all([
    linksEnabled
      ? new ProjectLinkService(requestContext.client).list(projectId).catch(() => [])
      : Promise.resolve([]),
    fileIntakeEnabled
      ? new FileIntakeService(requestContext.client, requestContext.storage).list(projectId).catch(() => [])
      : Promise.resolve([]),
    telegramEnabled
      ? new TelegramBridgeService(requestContext.client).listCandidates(projectId).catch(() => [])
      : Promise.resolve([]),
    integrationEnabled
      ? new IntegrationConnectionService(requestContext.client).listImportCandidates(projectId).catch(() => [])
      : Promise.resolve([]),
  ]);
  return (
    <div className="space-y-5">
      <Link href={`/dashboard/projectceo/projects/${projectId}`} className="text-sm text-muted hover:text-ink">
        ← {ru.projectCeo.actions.open}
      </Link>
      <ProjectInboxPanel
        projectId={projectId}
        links={links}
        files={files}
        telegramCandidates={telegramCandidates}
        importCandidates={importCandidates}
      />
    </div>
  );
}
