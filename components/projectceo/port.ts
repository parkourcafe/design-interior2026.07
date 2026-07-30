import type {
  PortfolioView,
  ProjectWorkspaceView,
  UiEnvelope,
} from "./contracts";

export interface ProjectCeoUiReadPort {
  getPortfolio(input: {
    readonly requestId: string;
  }): Promise<UiEnvelope<PortfolioView>>;

  getProjectWorkspace(input: {
    readonly projectId: string;
    readonly requestId: string;
  }): Promise<UiEnvelope<ProjectWorkspaceView>>;
}
