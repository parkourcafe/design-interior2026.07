import { describe, expect, it } from "vitest";

import {
  projectCeoInvitationLoginHref,
  safeProjectCeoLoginNext,
} from "../../../lib/project-intelligence/delivery/projectceo/invitation-login";

const token = "a".repeat(43);
const invitationPath = `/projectceo/invitations/${token}`;

describe("ProjectCEO invitation login continuation", () => {
  it("preserves the exact invitation path through login", () => {
    const href = projectCeoInvitationLoginHref(token);
    expect(href).toBe(`/login?next=${encodeURIComponent(invitationPath)}`);
    expect(safeProjectCeoLoginNext(new URL(href, "https://archidom.test").search))
      .toBe(invitationPath);
  });

  it.each([
    "https://attacker.test/steal",
    "//attacker.test/steal",
    "/\\attacker.test/steal",
    "/projectceo/invitations/too-short",
    `${invitationPath}?continue=https://attacker.test`,
    `/projectceo/invitations/${"a".repeat(42)}%2F`,
    "javascript:alert(1)",
  ])("rejects an untrusted next target: %s", (next) => {
    expect(safeProjectCeoLoginNext(`?next=${encodeURIComponent(next)}`)).toBe("/dashboard");
  });

  it("does not build a continuation URL for a malformed token", () => {
    expect(projectCeoInvitationLoginHref("../private-token")).toBe("/login");
  });
});
