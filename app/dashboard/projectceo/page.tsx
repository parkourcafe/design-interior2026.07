import { ProjectCeoPortfolio } from "@/components/projectceo/project-list";
import { createProjectCeoServerPort } from "@/lib/project-intelligence/delivery/projectceo/server-port";

export const dynamic = "force-dynamic";

export default async function ProjectCeoPage() {
  const port = await createProjectCeoServerPort();
  const result = await port.getPortfolio({
    requestId: crypto.randomUUID(),
  });
  if (!result.data || result.error) {
    throw new Error(`projectceo_portfolio_${result.error?.code ?? "empty"}`);
  }
  return <ProjectCeoPortfolio view={result.data} />;
}
