import "server-only";

import type { PostgresRpcClient } from "../../adapters/postgres";
import type { PrivateStorageClient } from "../../adapters/storage";
import { createClient } from "@/lib/supabase/server";

export interface ProjectCeoVerifiedIdentity {
  readonly userId: string;
  readonly displayName: string;
}

export interface ProjectCeoRequestContext {
  readonly client: PostgresRpcClient;
  readonly storage: PrivateStorageClient;
  readonly identity: ProjectCeoVerifiedIdentity;
}

interface AuthResult<T> {
  readonly data: T | null;
  readonly error: { readonly message?: string } | null;
}

export interface RequestBoundProjectCeoClient extends PostgresRpcClient {
  readonly storage: PrivateStorageClient;
  readonly auth: {
    getClaims(): Promise<AuthResult<{ readonly claims?: { readonly sub?: string } }>>;
    getUser(): Promise<
      AuthResult<{
        readonly user: {
          readonly id: string;
          readonly email?: string | null;
        } | null;
      }>
    >;
  };
}

export class ProjectCeoAuthenticationError extends Error {
  constructor(readonly code: "unauthenticated" | "identity_unverified") {
    super(`projectceo_${code}`);
    this.name = "ProjectCeoAuthenticationError";
  }
}

function controlledDisplayName(userId: string): string {
  return `Участник ${userId.slice(0, 8)}`;
}

/**
 * Verifies the request cookie JWT before any ProjectCEO RPC. getClaims validates
 * the JWT signature; getUser then confirms the current Auth user. The same
 * request-bound publishable/anon client is retained so PostgreSQL receives the
 * human JWT and RLS/RPC authorization derives actor and scope server-side.
 */
export async function verifyProjectCeoRequestClient(
  client: RequestBoundProjectCeoClient,
): Promise<ProjectCeoRequestContext> {
  const claimsResult = await client.auth.getClaims();
  const subject = claimsResult.data?.claims?.sub;
  if (claimsResult.error || !subject) {
    throw new ProjectCeoAuthenticationError("unauthenticated");
  }

  const userResult = await client.auth.getUser();
  const user = userResult.data?.user;
  if (userResult.error || !user || user.id !== subject) {
    throw new ProjectCeoAuthenticationError("identity_unverified");
  }

  return {
    client,
    storage: client.storage,
    identity: {
      userId: user.id,
      displayName: controlledDisplayName(user.id),
    },
  };
}

export async function createProjectCeoRequestContext(): Promise<ProjectCeoRequestContext> {
  const client = await createClient();
  return verifyProjectCeoRequestClient(
    client as unknown as RequestBoundProjectCeoClient,
  );
}
