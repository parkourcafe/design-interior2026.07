import "server-only";

import {
  PROJECTCEO_ROLES,
  type ProjectCeoRole,
} from "./contracts";

const DEFAULT_SERVER_ROLE: ProjectCeoRole = "owner";

export function resolveProjectCeoServerRole(
  configuredRole = process.env.PROJECTCEO_DEMO_ROLE,
): ProjectCeoRole {
  if (!configuredRole) return DEFAULT_SERVER_ROLE;
  return PROJECTCEO_ROLES.includes(configuredRole as ProjectCeoRole)
    ? configuredRole as ProjectCeoRole
    : DEFAULT_SERVER_ROLE;
}
