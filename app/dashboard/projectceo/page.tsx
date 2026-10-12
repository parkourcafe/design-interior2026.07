import { ProjectCeoPortfolio } from "@/components/projectceo/project-list";
import { ProjectCeoIdentityUnverified } from "@/components/projectceo/identity-unverified";
import { createProjectCeoServerPort } from "@/lib/project-intelligence/delivery/projectceo/server-port";
import { ProjectCeoAuthenticationError } from "@/lib/project-intelligence/delivery/projectceo/request-context";

export const dynamic = "force-dynamic";

export default async function ProjectCeoPage() {
  let port: Awaited<ReturnType<typeof createProjectCeoServerPort>>;
  try {
    port = await createProjectCeoServerPort();
  } catch (error) {
    if (error instanceof ProjectCeoAuthenticationError && error.code === "identity_unverified") {
      return <ProjectCeoIdentityUnverified />;
    }
    throw error;
  }
  const result = await port.getPortfolio({
    requestId: crypto.randomUUID(),
  });
  if (result.error?.code === "identity_unverified") return <ProjectCeoIdentityUnverified />;
  if (!result.data || result.error) {
    throw new Error(`projectceo_portfolio_${result.error?.code ?? "empty"}`);
  }
  return <ProjectCeoPortfolio view={result.data} />;
}
