import { notFound } from "next/navigation";
import { ProjectCeoWorkspace } from "@/components/projectceo/project-workspace";
import { createProjectCeoServerPort } from "@/lib/project-intelligence/delivery/projectceo/server-port";

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
  return <ProjectCeoWorkspace view={result.data} />;
}
