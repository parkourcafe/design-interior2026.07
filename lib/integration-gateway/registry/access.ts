import "server-only";

import { createProjectCeoServerPort } from "@/lib/project-intelligence/delivery/projectceo/server-port";
import { IntegrationGatewayForbiddenError } from "./http";

/** Provider settings and OAuth initiation are organization-owner operations. */
export async function requireIntegrationOwner() {
  const port = await createProjectCeoServerPort();
  const portfolio = await port.getPortfolio({ requestId: crypto.randomUUID() });
  if (!portfolio.data || portfolio.error || portfolio.data.actor.role !== "owner") {
    throw new IntegrationGatewayForbiddenError("owner_required");
  }
  return portfolio.data;
}
