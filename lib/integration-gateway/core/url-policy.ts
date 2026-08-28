import { z } from "zod";

export const projectLinkCategorySchema = z.enum([
  "reference",
  "product",
  "vendor",
  "legal",
  "ai",
  "tool",
  "other",
]);

export type ProjectLinkCategory = z.infer<typeof projectLinkCategorySchema>;

const forbiddenQueryKeys = new Set([
  "token",
  "key",
  "secret",
  "signature",
  "auth",
  "code",
  "access_token",
  "refresh_token",
  "client_secret",
  "credential",
  "password",
  "private_key",
  "jwt",
  "state",
]);

export class ProjectLinkUrlPolicyError extends Error {
  readonly code = "URL_POLICY_REJECTED" as const;

  constructor() {
    super("project_link_url_policy_rejected");
    this.name = "ProjectLinkUrlPolicyError";
  }
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) {
    return false;
  }
  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) return true;
  const [first, second = 0] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host.includes(":")) return true;
  if (/^\d+$/.test(host) || isPrivateIpv4(host)) return true;
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host.endsWith(".home") ||
    host.endsWith(".test") ||
    host.endsWith(".invalid")
  );
}

export interface NormalizedProjectLinkUrl {
  readonly normalizedUrl: string;
  readonly domain: string;
}

export function normalizeProjectLinkUrl(input: string): NormalizedProjectLinkUrl {
  const value = input.trim();
  if (!value || value.length > 4096 || /[\s\u0000-\u001f\u007f]/.test(value)) {
    throw new ProjectLinkUrlPolicyError();
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ProjectLinkUrlPolicyError();
  }

  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) {
    throw new ProjectLinkUrlPolicyError();
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new ProjectLinkUrlPolicyError();
  }

  for (const key of parsed.searchParams.keys()) {
    if (forbiddenQueryKeys.has(key.toLowerCase())) {
      throw new ProjectLinkUrlPolicyError();
    }
  }

  parsed.hash = "";
  const normalizedUrl = parsed.toString();
  if (normalizedUrl.length > 4096) throw new ProjectLinkUrlPolicyError();
  return {
    normalizedUrl,
    domain: parsed.hostname.toLowerCase(),
  };
}
