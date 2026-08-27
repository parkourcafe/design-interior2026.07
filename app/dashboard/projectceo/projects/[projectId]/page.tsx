import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectCeoWorkspace } from "@/components/projectceo/project-workspace";
import { createProjectCeoServerPort } from "@/lib/project-intelligence/delivery/projectceo/server-port";
import { projectLinksEnabled } from "@/lib/integration-gateway/links/http";
import { ru } from "@/lib/i18n/ru";

export const dynamic = "force-dynamic";

export default async function ProjectCeoProjectPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const port = await createProjectCeoServerPort();
  const result = await port.getProjectWorkspace({
    projectId,
    requestId: crypto.randomUUID(),
  });
  if (result.error?.code === "not_found") notFound();
  if (!result.data || result.error) {
    throw new Error(`projectceo_workspace_${result.error?.code ?? "empty"}`);
  }
  return (
    <>
      {projectLinksEnabled() && (
        <div className="mb-4 flex justify-end">
          <Link
            href={`/dashboard/projectceo/projects/${projectId}/links`}
            className="btn-ghost"
          >
            {ru.projectLinks.open}
          </Link>
        </div>
      )}
      {process.env.REMHAOS_INTEGRATIONS_ENABLED === "true" && (
        <div className="mb-4 flex justify-end">
          <Link
            href={`/dashboard/projectceo/projects/${projectId}/connections`}
            className="btn-ghost"
          >
            {ru.projectConnections.open}
          </Link>
          <Link
            href={`/dashboard/projectceo/projects/${projectId}/inbox`}
            className="btn-ghost ml-2"
          >
            {ru.projectConnections.inbox}
          </Link>
        </div>
      )}
      <ProjectCeoWorkspace view={result.data} />
    </>
  );
}
