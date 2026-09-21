import { describe, expect, it } from "vitest";
import { extractCookieSession } from "./cookie-session";

const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const b64 = (value: string) => Buffer.from(value).toString("base64url");
const jwt = `${b64('{"alg":"none"}')}.${b64(JSON.stringify({ sub: userId, session_id: sessionId }))}.signature`;
const stored = `base64-${b64(JSON.stringify({ access_token: jwt, refresh_token: "must-not-return" }))}`;
const jarLine = (name: string, value: string) => `#HttpOnly_127.0.0.1\tFALSE\t/\tFALSE\t0\t${name}\t${value}`;

describe("AP6 cookie session provenance", () => {
  it("extracts only user and actual session from a chunked SSR auth cookie", () => {
    const split = Math.floor(stored.length / 2);
    const jar = [jarLine("sb-local-auth-token.0", stored.slice(0, split)), jarLine("sb-local-auth-token.1", stored.slice(split))].join("\n");
    const result = extractCookieSession(jar);
    expect(result).toEqual({ userId, sessionId });
    expect(JSON.stringify(result)).not.toContain("access_token");
    expect(JSON.stringify(result)).not.toContain("refresh_token");
  });

  it.each([
    ["missing", ""],
    ["gap", jarLine("sb-local-auth-token.1", stored)],
    ["duplicate", [jarLine("sb-local-auth-token", stored), jarLine("sb-local-auth-token.0", stored)].join("\n")],
    ["bad json", jarLine("sb-local-auth-token", "base64-bm90LWpzb24")],
  ])("rejects %s cookie evidence", (_name, jar) => {
    expect(() => extractCookieSession(jar)).toThrow(/COOKIE_SESSION_/);
  });
});
