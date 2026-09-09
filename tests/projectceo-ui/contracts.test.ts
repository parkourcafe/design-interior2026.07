import { describe, expect, it } from "vitest";
import {
  ANALYTICS_EVENTS,
  PROJECTCEO_CAPABILITIES,
  PROJECTCEO_ROLES,
  PROJECTCEO_TABS,
  PROJECTCEO_UI_CONTRACT_VERSION,
  UI_SCENARIOS,
} from "../../components/projectceo/contracts";
import {
  errorForScenario,
  isTerminalAccessState,
} from "../../components/projectceo/ui-state";

describe("ProjectCEO UI contract", () => {
  it("has a stable versioned envelope contract", () => {
    expect(PROJECTCEO_UI_CONTRACT_VERSION).toBe("projectceo-ui/0.1");
    expect(PROJECTCEO_ROLES).toEqual([
      "owner",
      "architect",
      "builder",
      "client",
      "guest",
    ]);
  });

  it("exposes the frozen ProjectCEO navigation", () => {
    // "documentation" появилась вместе с открытием модуля 3 по A5; список
    // остаётся замком — расширять его можно только вместе с этой строкой.
    expect(PROJECTCEO_TABS).toEqual([
      "overview",
      "passport",
      "sources",
      "decisions",
      "documentation",
      "baseline",
      "releases",
      "changes",
      "participants",
      "history",
    ]);
  });

  it("models all explicit screen states with safe error codes", () => {
    expect(UI_SCENARIOS).toEqual([
      "ready",
      "loading",
      "empty",
      "error",
      "stale",
      "revoked",
      "expired",
    ]);
    expect(errorForScenario("stale")).toEqual({
      code: "stale_state",
      messageKey: "projectceo.stale_state",
      retryable: true,
    });
    expect(errorForScenario("revoked")?.retryable).toBe(false);
    expect(errorForScenario("ready")).toBeNull();
    expect(isTerminalAccessState("expired")).toBe(true);
    expect(isTerminalAccessState("loading")).toBe(false);
  });

  it("keeps role capabilities and controlled pilot analytics explicit", () => {
    expect(PROJECTCEO_CAPABILITIES).toContain("acknowledge_release");
    expect(PROJECTCEO_CAPABILITIES).toContain("review_change_impact");
    expect(ANALYTICS_EVENTS).toEqual(expect.arrayContaining([
      "organization_created",
      "project_created",
      "invitation_sent",
      "source_reviewed",
      "baseline_published",
      "selection_reviewed",
      "release_acknowledged",
      "change_requested",
      "impact_reviewed",
      "second_project_started",
    ]));
  });
});
