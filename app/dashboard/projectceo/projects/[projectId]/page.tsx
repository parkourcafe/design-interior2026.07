import { notFound } from "next/navigation";
import { ProjectCeoWorkspace } from "@/components/projectceo/project-workspace";
import { ProjectCeoIdentityUnverified } from "@/components/projectceo/identity-unverified";
import { createProjectCeoServerPort } from "@/lib/project-intelligence/delivery/projectceo/server-port";
import { ProjectCeoAuthenticationError } from "@/lib/project-intelligence/delivery/projectceo/request-context";

export const dynamic = "force-dynamic";

export default async function ProjectCeoProjectPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  let port: Awaited<ReturnType<typeof createProjectCeoServerPort>>;
  try {
    port = await createProjectCeoServerPort();
  } catch (error) {
    if (error instanceof ProjectCeoAuthenticationError && error.code === "identity_unverified") {
      return <ProjectCeoIdentityUnverified />;
    }
    throw error;
  }
  const result = await port.getProjectWorkspace({
    projectId,
    requestId: crypto.randomUUID(),
  });
  if (result.error?.code === "not_found") notFound();
  if (result.error?.code === "identity_unverified") return <ProjectCeoIdentityUnverified />;
  if (!result.data || result.error) {
    throw new Error(`projectceo_workspace_${result.error?.code ?? "empty"}`);
  }
  return <ProjectCeoWorkspace view={result.data} />;
}
