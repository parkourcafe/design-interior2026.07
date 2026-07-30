import "server-only";

import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

function boundedTrimmedText(maxLength: number) {
  return z.string().min(1).max(maxLength).refine(
    (value) => value === value.trim(),
    "Expected trimmed text",
  );
}

const guestReleaseProjectionSchema = z.object({
  allowAcknowledgement: z.boolean(),
  expiresAt: z.string().datetime({ offset: true }),
  package: z.object({
    id: z.string().uuid(),
    kind: z.enum(["project_root", "work_package"]),
    name: boundedTrimmedText(500),
    stableKey: boundedTrimmedText(160),
  }),
  projectId: z.string().uuid(),
  release: z.object({
    graphDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    publishedAt: z.string().datetime({ offset: true }),
    versionId: boundedTrimmedText(160),
    versionNo: z.number().int().nonnegative().safe(),
  }),
});

const guestReleaseEnvelopeSchema = z.object({
  contractVersion: z.literal("project-ceo-foundation/0.1"),
  requestId: boundedTrimmedText(160),
  data: guestReleaseProjectionSchema,
  error: z.null(),
});

export type GuestReleaseProjection = z.infer<
  typeof guestReleaseProjectionSchema
>;

export type ProjectCeoGuestLinkErrorCode =
  | "invalid_token"
  | "revoked"
  | "expired"
  | "not_found"
  | "forbidden"
  | "internal_error";

export class ProjectCeoGuestLinkError extends Error {
  constructor(public readonly code: ProjectCeoGuestLinkErrorCode) {
    super("Unable to read guest release");
    this.name = "ProjectCeoGuestLinkError";
  }
}

export interface GuestReleaseRpcClient {
  schema(name: string): {
    rpc(
      functionName: string,
      args: { token_digest: string },
    ): PromiseLike<{ data: unknown; error: unknown }>;
  };
}

export function createProjectCeoGuestRpcClient(
  environment: NodeJS.ProcessEnv = process.env,
): GuestReleaseRpcClient {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey =
    environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    environment.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !publicKey) {
    throw new ProjectCeoGuestLinkError("internal_error");
  }

  return createClient(url, publicKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  }) as unknown as GuestReleaseRpcClient;
}

function decodeCanonicalGuestToken(token: string): Buffer {
  if (
    typeof token !== "string" ||
    token.length !== 43 ||
    !/^[A-Za-z0-9_-]{43}$/.test(token)
  ) {
    throw new ProjectCeoGuestLinkError("invalid_token");
  }

  const bytes = Buffer.from(token, "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== token) {
    throw new ProjectCeoGuestLinkError("invalid_token");
  }

  return bytes;
}

function mapGuestReleaseErrorCode(
  error: unknown,
): ProjectCeoGuestLinkErrorCode {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : null;

  switch (code) {
    case "P1106":
      return "revoked";
    case "P1105":
      return "expired";
    case "P1104":
      return "not_found";
    case "P1103":
    case "42501":
      return "forbidden";
    default:
      return "internal_error";
  }
}

export async function readProjectCeoGuestRelease(
  token: string,
  client?: GuestReleaseRpcClient,
): Promise<GuestReleaseProjection> {
  const tokenBytes = decodeCanonicalGuestToken(token);
  const tokenDigest = `\\x${createHash("sha256")
    .update(tokenBytes)
    .digest("hex")}`;

  const rpcClient = client ?? createProjectCeoGuestRpcClient();

  const result = await rpcClient
    .schema("projectceo_api")
    .rpc("read_guest_release", { token_digest: tokenDigest });

  if (result.error) {
    throw new ProjectCeoGuestLinkError(mapGuestReleaseErrorCode(result.error));
  }

  const envelope = guestReleaseEnvelopeSchema.safeParse(result.data);
  if (!envelope.success) {
    throw new ProjectCeoGuestLinkError("internal_error");
  }

  return envelope.data.data;
}
