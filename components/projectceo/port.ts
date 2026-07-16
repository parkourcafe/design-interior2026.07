import type {
  PortfolioView,
  ProjectCeoRole,
  ProjectWorkspaceView,
  UiEnvelope,
} from "./contracts";

export interface ProjectCeoUiReadPort {
  getPortfolio(input: {
    readonly role: ProjectCeoRole;
    readonly requestId: string;
  }): Promise<UiEnvelope<PortfolioView>>;

  getProjectWorkspace(input: {
    readonly projectId: string;
    readonly role: ProjectCeoRole;
    readonly packageId: string | null;
    readonly requestId: string;
  }): Promise<UiEnvelope<ProjectWorkspaceView>>;
}
