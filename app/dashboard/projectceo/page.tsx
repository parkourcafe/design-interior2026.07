import { createProjectCeoMockPort } from "@/components/projectceo/mock";
import { ProjectCeoPortfolio } from "@/components/projectceo/project-list";
import { resolveProjectCeoServerRole } from "@/components/projectceo/server-role";

export const dynamic = "force-dynamic";

export default async function ProjectCeoPage() {
  const port = createProjectCeoMockPort();
  const role = resolveProjectCeoServerRole();
  const result = await port.getPortfolio({
    role,
    requestId: `portfolio-${role}`,
  });
  if (!result.data || result.error) {
    throw new Error(`projectceo_portfolio_${result.error?.code ?? "empty"}`);
  }
  return <ProjectCeoPortfolio view={result.data} />;
}
