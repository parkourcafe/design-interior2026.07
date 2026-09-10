import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import {
  assertExactPackageScope,
  can,
  capabilitiesForRole,
  visibleTabsForRole,
} from "../../components/projectceo/role-policy";
import { loadSanitizedRoleMatrixForTest } from "./role-harness";

const migration = readFileSync(join(
  process.cwd(),
  "supabase/migrations/20260802030000_projectceo_m2_workspace_revisions.sql",
), "utf8");

function capabilitiesFromMigration(dbRole: string): string[] {
  const match = migration.match(new RegExp(
    `when '${dbRole}' then array\\[([\\s\\S]*?)\\]::text\\[\\]`,
  ));
  if (!match?.[1]) throw new Error(`role ${dbRole} missing from capability migration`);
  return [...match[1].matchAll(/'([^']+)'/g)].map(([ , capability ]) => capability!);
}

describe("ProjectCEO role-scoped UI policy", () => {
  it("reserves project and access management for owner", () => {
    expect(can("owner", "manage_project")).toBe(true);
    expect(can("owner", "manage_access")).toBe(true);
    expect(can("architect", "manage_access")).toBe(false);
    expect(can("builder", "publish_release")).toBe(false);
    expect(can("client", "review_selection")).toBe(true);
  });

  it("mirrors the database capability sets for builder and client exactly", () => {
    // Ровно те наборы, что выдаёт `projectceo_foundation._role_capabilities`
    // (20260802030000) для builder и client_approver. Лишняя капабилити в UI
    // означает кнопку, которую база отклонит P1103, — это не «щедрость», а
    // ложное обещание поверхности (A6 §4.2.5).
    expect(capabilitiesForRole("builder")).toEqual([
      "view_project",
      "register_source",
      "acknowledge_release",
      "create_change",
      "upload_photo_evidence",
    ]);
    expect(capabilitiesForRole("client")).toEqual([
      "view_project",
      "review_selection",
      "acknowledge_release",
      "create_change",
      "review_milestone",
    ]);
  });

  it("keeps every authenticated role capability set in migration parity", () => {
    const roleMap = {
      owner: "owner_lead",
      architect: "architect",
      builder: "builder",
      client: "client_approver",
    } as const;
    for (const [uiRole, dbRole] of Object.entries(roleMap) as Array<[
      keyof typeof roleMap,
      (typeof roleMap)[keyof typeof roleMap],
    ]>) {
      expect([...capabilitiesForRole(uiRole)], uiRole).toEqual(capabilitiesFromMigration(dbRole));
    }
  });

  it("never gives a guest source, member, audit or change controls", () => {
    expect(capabilitiesForRole("guest")).toEqual([
      "view_project",
      "acknowledge_release",
    ]);
    expect(visibleTabsForRole("guest")).toEqual([
      "overview",
      "releases",
    ]);
    expect(can("guest", "review_source")).toBe(false);
    expect(can("guest", "view_audit")).toBe(false);
    expect(can("guest", "create_change")).toBe(false);
  });

  it("shows participant views without owner-only administration", () => {
    // Строителю сервер разрешает register_source (капабилити и в UI-политике,
    // и в серверной карте): без вкладки источников это право было бы мёртвым
    // аффордансом. Ревью-контролы внутри вкладки строителю недоступны — у него
    // нет review_claim, и кнопки честно объясняют почему.
    expect(visibleTabsForRole("builder")).toEqual([
      "overview",
      "sources",
      "decisions",
      "baseline",
      "releases",
      "changes",
    ]);
    expect(visibleTabsForRole("client")).not.toContain("participants");
    expect(visibleTabsForRole("client")).not.toContain("history");
    expect(visibleTabsForRole("client")).not.toContain("passport");
    expect(visibleTabsForRole("builder")).not.toContain("passport");
    expect(visibleTabsForRole("guest")).not.toContain("passport");
    expect(visibleTabsForRole("owner")).toContain("passport");
    expect(visibleTabsForRole("architect")).toContain("passport");
  });

  it("requires an exact package for guest scope", () => {
    expect(assertExactPackageScope({
      role: "guest",
      actorPackageId: "package-a",
      requestedPackageId: "package-a",
    })).toBe(true);
    expect(assertExactPackageScope({
      role: "guest",
      actorPackageId: "package-a",
      requestedPackageId: null,
    })).toBe(false);
    expect(assertExactPackageScope({
      role: "guest",
      actorPackageId: "package-a",
      requestedPackageId: "package-b",
    })).toBe(false);
    expect(assertExactPackageScope({
      role: "architect",
      actorPackageId: null,
      requestedPackageId: "package-b",
    })).toBe(true);
  });

  it("keeps the multi-role walkthrough in an explicit test-only harness", async () => {
    const matrix = await loadSanitizedRoleMatrixForTest();

    expect([...matrix.portfolios.keys()]).toEqual([
      "owner",
      "architect",
      "builder",
      "client",
      "guest",
    ]);
    expect(matrix.workspaces.get("owner")?.sources).toHaveLength(209);
    expect(matrix.workspaces.get("guest")?.sources).toEqual([]);
  });
});
