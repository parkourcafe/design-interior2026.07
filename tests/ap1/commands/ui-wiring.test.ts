import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  projectCeoCommandSchema,
  projectCeoInvitationAcceptSchema,
} from "../../../lib/project-intelligence/delivery/projectceo/command-contract";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("AP1 command/UI wiring", () => {
  it("keeps invitation creation and release distribution strict and authority-free", () => {
    const invitation = {
      contractVersion: "projectceo-command/0.1",
      commandId: "11111111-1111-4111-8111-111111111111",
      kind: "create_invitation",
      projectId: "22222222-2222-4222-8222-222222222222",
      payload: {
        recipientEmail: "person@example.test",
        targetRole: "client",
        expiresAt: "2026-07-25T00:00:00.000Z",
      },
    };
    expect(projectCeoCommandSchema.safeParse(invitation).success).toBe(true);
    expect(projectCeoCommandSchema.safeParse({
      ...invitation,
      expectedStateRevision: 4,
    }).success).toBe(false);

    const distribution = {
      contractVersion: "projectceo-command/0.1",
      commandId: "33333333-3333-4333-8333-333333333333",
      kind: "distribute_release",
      projectId: invitation.projectId,
      payload: {
        productionPackageVersionId: "release-v1",
        recipientUserId: "44444444-4444-4444-8444-444444444444",
      },
    };
    expect(projectCeoCommandSchema.safeParse(distribution).success).toBe(true);
    expect(projectCeoCommandSchema.safeParse({
      ...distribution,
      payload: { ...distribution.payload, packageId: "attacker-scope" },
    }).success).toBe(false);
  });

  it("accepts only a fixed-size opaque invitation token", () => {
    expect(projectCeoInvitationAcceptSchema.safeParse({
      contractVersion: "projectceo-invitation-accept/0.1",
      token: "A".repeat(43),
    }).success).toBe(true);
    expect(projectCeoInvitationAcceptSchema.safeParse({
      contractVersion: "projectceo-invitation-accept/0.1",
      token: "../private-token",
    }).success).toBe(false);
  });

  it("wires only real command API paths and retains a read-only fixture", () => {
    const onboarding = source("components/projectceo/onboarding.tsx");
    const workspace = source("components/projectceo/project-workspace.tsx");
    const invitation = source("components/projectceo/invitation-accept.tsx");
    const fixture = source("components/projectceo/mock.ts");
    for (const kind of [
      "create_invitation",
      "revoke_invitation",
      "distribute_release",
      "acknowledge_release",
      "create_change",
      "review_change_impact",
      "upload_photo_evidence",
      "review_photo_evidence",
      "accept_milestone",
    ]) {
      expect(`${onboarding}\n${workspace}`).toContain(`kind: "${kind}"`);
    }
    expect(invitation).toContain("/api/projectceo/invitations/accept");
    expect(workspace).toContain("source.packageId === packageId");
    expect(fixture).not.toContain('status: "completed"');
    expect(`${onboarding}\n${workspace}\n${invitation}`).not.toMatch(/service[_-]?role/i);
  });
});
