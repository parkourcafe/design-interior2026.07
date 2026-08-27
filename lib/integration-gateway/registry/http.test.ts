import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ProjectIntelligenceAdapterError } from "@/lib/project-intelligence/adapters/postgres/errors";
import { integrationGatewayErrorResponse, parseIntegrationJson } from "./http";

const jsonHeaders = { "content-type": "application/json" };

describe("Integration Gateway JSON boundary", () => {
  it("rejects oversized chunked JSON before full buffering", async () => {
    await expect(parseIntegrationJson(new Request("http://127.0.0.1/integration", {
      method: "POST",
      headers: jsonHeaders,
      body: "x".repeat(32 * 1024 + 1),
    }))).rejects.toThrow("body_too_large");
  });

  it("accepts valid JSON and rejects invalid UTF-8", async () => {
    await expect(parseIntegrationJson(new Request("http://127.0.0.1/integration", {
      method: "POST",
      headers: jsonHeaders,
      body: '{"ok":true}',
    }))).resolves.toEqual({ ok: true });
    await expect(parseIntegrationJson(new Request("http://127.0.0.1/integration", {
      method: "POST",
      headers: jsonHeaders,
      body: new Uint8Array([0xff]),
    }))).rejects.toThrow("invalid_json");
  });

  it("maps consumed OAuth intents to a controlled conflict", async () => {
    const response = integrationGatewayErrorResponse(
      new ProjectIntelligenceAdapterError("expired", "P1205"),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "expired_or_consumed" },
    });
  });
});
