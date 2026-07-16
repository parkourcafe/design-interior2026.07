import { notFound } from "next/navigation";
import {
  createProjectCeoMockPort,
  KORA_ARCHITECTURE_PACKAGE_ID,
} from "@/components/projectceo/mock";
import { ProjectCeoWorkspace } from "@/components/projectceo/project-workspace";
import { resolveProjectCeoServerRole } from "@/components/projectceo/server-role";

export const dynamic = "force-dynamic";

export default async function ProjectCeoProjectPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const port = createProjectCeoMockPort();
  const role = resolveProjectCeoServerRole();
  const result = await port.getProjectWorkspace({
    projectId,
    role,
    packageId: role === "guest" ? KORA_ARCHITECTURE_PACKAGE_ID : null,
    requestId: `workspace-${role}`,
  });
  if (result.error?.code === "not_found") notFound();
  if (!result.data || result.error) {
    throw new Error(`projectceo_workspace_${result.error?.code ?? "empty"}`);
  }
  return <ProjectCeoWorkspace view={result.data} />;
}
