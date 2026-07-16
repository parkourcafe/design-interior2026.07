import type {
  PortfolioView,
  ProjectCeoRole,
  ProjectWorkspaceView,
} from "../../components/projectceo/contracts";
import {
  createProjectCeoMockPort,
  KORA_ARCHITECTURE_PACKAGE_ID,
  KORA_PROJECT_ID,
} from "../../components/projectceo/mock";

const TEST_ROLES: readonly ProjectCeoRole[] = [
  "owner",
  "architect",
  "builder",
  "client",
  "guest",
];

export async function loadSanitizedRoleMatrixForTest(): Promise<{
  readonly portfolios: ReadonlyMap<ProjectCeoRole, PortfolioView>;
  readonly workspaces: ReadonlyMap<ProjectCeoRole, ProjectWorkspaceView>;
}> {
  const port = createProjectCeoMockPort();
  const portfolioEntries = await Promise.all(TEST_ROLES.map(async (role) => {
    const result = await port.getPortfolio({
      role,
      requestId: `test-portfolio-${role}`,
    });
    if (!result.data || result.error) throw new Error("test_portfolio_fixture_failed");
    return [role, result.data] as const;
  }));
  const workspaceEntries = await Promise.all(TEST_ROLES.map(async (role) => {
    const result = await port.getProjectWorkspace({
      projectId: KORA_PROJECT_ID,
      role,
      packageId: role === "guest" ? KORA_ARCHITECTURE_PACKAGE_ID : null,
      requestId: `test-workspace-${role}`,
    });
    if (!result.data || result.error) throw new Error("test_workspace_fixture_failed");
    return [role, result.data] as const;
  }));
  return {
    portfolios: new Map(portfolioEntries),
    workspaces: new Map(workspaceEntries),
  };
}
