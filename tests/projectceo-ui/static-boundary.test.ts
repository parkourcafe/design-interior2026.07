import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const UI_FILES = [
  "app/dashboard/projectceo/page.tsx",
  "app/dashboard/projectceo/projects/[projectId]/page.tsx",
  "components/projectceo/mock.ts",
  "components/projectceo/port.ts",
  "components/projectceo/project-list.tsx",
  "components/projectceo/project-workspace.tsx",
  "components/projectceo/m1-project-panel.tsx",
  "components/projectceo/command-client.tsx",
] as const;

const DEPLOYABLE_PAGES = [
  "app/dashboard/projectceo/page.tsx",
  "app/dashboard/projectceo/projects/[projectId]/page.tsx",
] as const;

const DEPLOYABLE_CLIENTS = [
  "components/projectceo/project-list.tsx",
  "components/projectceo/project-workspace.tsx",
] as const;

function read(files: readonly string[]): string {
  return files.map((file) => (
    readFileSync(resolve(process.cwd(), file), "utf8")
  )).join("\n");
}

describe("ProjectCEO UI static architecture boundary", () => {
  const source = read(UI_FILES);
  const pageSource = read(DEPLOYABLE_PAGES);
  const clientSource = read(DEPLOYABLE_CLIENTS);

  it("has no direct Supabase, admin client, fetch or table access", () => {
    expect(source).not.toMatch(/@supabase|createClient|service[_ -]?role/i);
    expect(pageSource).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\.from\s*\(\s*["'`]/);
    expect(source).not.toMatch(/\b(private|public)\.[a-z_]+\b/i);
  });

  it("does not embed production filenames or local absolute paths", () => {
    expect(source).not.toMatch(/\/Users\//);
    expect(source).not.toMatch(/KORA_Construction/i);
    expect(source).not.toMatch(/DWG - Restaurant/i);
    expect(source).not.toMatch(/02 Second Floor/i);
  });

  it("routes all reads through the versioned UI port", () => {
    expect(pageSource).toContain("createProjectCeoServerPort");
    expect(source).toContain("getPortfolio");
    expect(source).toContain("getProjectWorkspace");
    expect(source).toContain("PROJECTCEO_UI_CONTRACT_VERSION");
  });

  it("hydrates exactly one server-derived actor projection per route", () => {
    expect(pageSource).not.toContain("PROJECTCEO_DEMO_ROLE");
    expect(pageSource).not.toMatch(/\brole\s*:/);
    expect(pageSource).not.toMatch(/\bpackageId\s*:/);
    expect(pageSource).not.toMatch(/ROLES\.map|Promise\.all|Object\.fromEntries/);
    expect(pageSource).not.toMatch(/searchParams|URLSearchParams/);
    expect(pageSource).not.toMatch(/Record<ProjectCeoRole,\s*(PortfolioView|ProjectWorkspaceView)>/);
    expect(pageSource).toContain("<ProjectCeoPortfolio view={result.data}");
    expect(pageSource).toContain("<ProjectCeoWorkspace view={result.data}");
  });

  it("contains no deployable synthetic mutation success", () => {
    expect(source).not.toMatch(
      /simulatedInvite|local-preview|photoPreviewAdded|localReviews|setPublished|setAcknowledged|setChanges|change-request-local-preview|setRevoked|revokedLocally|localRevoked/,
    );
  });

  it("requires an actual approval reason before an immutable decision", () => {
    const m1Source = readFileSync(
      resolve(process.cwd(), "components/projectceo/m1-project-panel.tsx"),
      "utf8",
    );
    expect(m1Source).toContain("reason: decisionReason.trim()");
    expect(m1Source).toContain("disabled={decisionReason.trim().length < 3}");
    expect(m1Source).not.toContain("Что проверено человеком");
  });

  it("does not expose deployable client role switching or sibling role DTO props", () => {
    expect(clientSource).not.toMatch(/\bviews\b|setRole\(|roleOptions|onRole/);
    expect(clientSource).not.toMatch(/Record<ProjectCeoRole,\s*(PortfolioView|ProjectWorkspaceView)>/);
    expect(clientSource).not.toMatch(/Показать интерфейс роли|Роль участника/);
    expect(clientSource).toContain("const role = view.actor.role");
  });

  it("sources ProjectCEO display copy from the central RU dictionary", () => {
    const legacyDictionary = resolve(
      process.cwd(),
      "components/projectceo/ru.ts",
    );
    expect(existsSync(legacyDictionary)).toBe(false);
    for (const file of [
      "components/projectceo/project-list.tsx",
      "components/projectceo/project-workspace.tsx",
      "components/projectceo/onboarding.tsx",
      "components/projectceo/state-panel.tsx",
      "components/projectceo/copy-link-button.tsx",
      "components/projectceo/mock.ts",
    ]) {
      expect(readFileSync(resolve(process.cwd(), file), "utf8")).toContain(
        "@/lib/i18n/ru",
      );
    }
    expect(readFileSync(resolve(process.cwd(), "lib/i18n/ru.ts"), "utf8"))
      .toContain("projectCeo:");
    expect(source).not.toMatch(/[А-Яа-яЁё]/);
  });
});
