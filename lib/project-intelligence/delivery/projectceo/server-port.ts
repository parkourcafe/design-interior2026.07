import "server-only";

import { createProjectCeoMockPort } from "@/components/projectceo/mock";
import type { ProjectCeoUiReadPort } from "@/components/projectceo/port";
import {
  PROJECTCEO_ROLES,
  type ProjectCeoRole,
} from "@/components/projectceo/contracts";
import { ProjectCeoLiveReadPort } from "./live-read-port";
import { createProjectCeoRequestContext, type ProjectCeoVerifiedIdentity } from "./request-context";

export const PROJECTCEO_LOCAL_FIXTURE_FLAG = "PROJECTCEO_LOCAL_FIXTURE_MODE";

export function isProjectCeoLocalFixtureMode(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  if (environment.PROJECTCEO_LOCAL_FIXTURE_MODE !== "1") return false;
  if (environment.NODE_ENV === "production") {
    throw new Error("projectceo_fixture_mode_forbidden_in_production");
  }
  return true;
}

function fixtureRole(environment: NodeJS.ProcessEnv): ProjectCeoRole {
  const configured = environment.PROJECTCEO_LOCAL_FIXTURE_ROLE;
  return PROJECTCEO_ROLES.includes(configured as ProjectCeoRole)
    ? configured as ProjectCeoRole
    : "owner";
}

/**
 * The only deployable UI factory. Production always verifies a request-bound
 * human and uses their JWT. The deterministic Kora fixture is opt-in, local
 * only and read-only; no legacy role override is consulted.
 */
export async function createProjectCeoServerRequest(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<{ readonly port: ProjectCeoUiReadPort; readonly identity: ProjectCeoVerifiedIdentity | null }> {
  if (isProjectCeoLocalFixtureMode(environment)) {
    return { port: createProjectCeoMockPort(fixtureRole(environment)), identity: null };
  }
  const context = await createProjectCeoRequestContext();
  return { port: new ProjectCeoLiveReadPort(context.client, context.identity), identity: context.identity };
}

export async function createProjectCeoServerPort(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ProjectCeoUiReadPort> {
  return (await createProjectCeoServerRequest(environment)).port;
}
