import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { POST } from "../../app/api/projectceo/commands/route";

const endpoint = "https://app.example/api/projectceo/commands";

function request(body: BodyInit | null, headers: HeadersInit): Request {
  return new Request(endpoint, { method: "POST", headers, body });
}

describe("ProjectCEO command route early security paths", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("rejects a cross-origin mutation before parsing or authentication", async () => {
    const response = await POST(request("{}", {
      Origin: "https://evil.example",
      "Content-Type": "application/json",
    }));
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      status: "error",
      error: { code: "forbidden" },
    });
  });

  it("rejects unsupported content type and malformed JSON deterministically", async () => {
    const unsupported = await POST(request("{}", {
      Origin: "https://app.example",
      "Content-Type": "text/plain",
    }));
    expect(unsupported.status).toBe(415);
    const malformed = await POST(request("{", {
      Origin: "https://app.example",
      "Content-Type": "application/json",
    }));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({
      error: { code: "validation_failed" },
    });
  });

  it("does not echo rejected authority fields or recipient data", async () => {
    const marker = "private-recipient@example.test";
    const response = await POST(request(JSON.stringify({
      contractVersion: "projectceo-command/0.1",
      commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      kind: "create_invitation",
      projectId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      actorId: "attacker-controlled",
      payload: { recipientEmail: marker, targetRole: "architect" },
    }), {
      Origin: "https://app.example",
      "Content-Type": "application/json",
    }));
    const text = await response.text();
    expect(response.status).toBe(400);
    expect(text).not.toContain(marker);
    expect(text).not.toContain("attacker-controlled");
  });

  it("keeps the optional local fixture command surface read-only", async () => {
    vi.stubEnv("PROJECTCEO_LOCAL_FIXTURE_MODE", "1");
    const response = await POST(request(JSON.stringify({
      contractVersion: "projectceo-command/0.1",
      commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      kind: "create_change",
      projectId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      payload: {
        reason: "Контролируемая локальная проверка",
        fromProductionPackageVersionId: "package-version-1",
        deltaCostRub: 0,
        deltaDays: 0,
      },
    }), {
      Origin: "https://app.example",
      "Content-Type": "application/json",
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      status: "unavailable",
      error: { code: "operation_unavailable" },
    });
  });
});
