import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  executeCalls: 0,
}));

vi.mock("@/lib/project-intelligence/delivery/projectceo/request-context", () => ({
  PROJECTCEO_SESSION_PROVENANCE_HEADER: "X-ArchiDom-Auth-Session-Digest",
  ProjectCeoAuthenticationError: class ProjectCeoAuthenticationError extends Error {},
  createProjectCeoRequestContext: vi.fn(async () => ({
    client: { requestBound: true },
    identity: { userId: "user-1", sessionDigest: `sha256:${"a".repeat(64)}` },
  })),
}));

vi.mock("@/lib/project-intelligence/delivery/projectceo/command-service", () => ({
  ProjectCeoCommandService: class {
    async execute() {
      state.executeCalls += 1;
      return {
        contractVersion: "projectceo-command/0.1",
        requestId: "request-1",
        status: "completed",
        operation: "submit_change_request",
        replay: false,
        stateRevision: 1,
        result: { id: "change-1" },
      };
    }
  },
}));

vi.mock("@/lib/project-intelligence/delivery/projectceo/server-port", () => ({
  isProjectCeoLocalFixtureMode: () => false,
}));

import { POST } from "../../app/api/projectceo/commands/route";

const endpoint = "https://app.example/api/projectceo/commands";

// A 96 KiB envelope leaves 32 KiB for command metadata around the supported
// 64 KiB layout JSON payload. This is the total decoded HTTP request-body cap.
const MAX_COMMAND_BODY_BYTES = 96 * 1024;
const baseHeaders = {
  Origin: "https://app.example",
  "Content-Type": "application/json",
};

const validCommand = JSON.stringify({
  contractVersion: "projectceo-command/0.1",
  commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  kind: "create_change",
  projectId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  payload: {
    reason: "Контролируемое изменение",
    fromProductionPackageVersionId: "release-v1",
    deltaCostRub: 0,
    deltaDays: 0,
  },
});

function streamingRequest(options: {
  readonly contentLength?: string;
  readonly totalBytes: number;
  readonly chunkBytes?: number;
}) {
  const chunkBytes = options.chunkBytes ?? 1024;
  let bytesEnqueued = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const remaining = options.totalBytes - bytesEnqueued;
      if (remaining <= 0) {
        controller.close();
        return;
      }
      const size = Math.min(chunkBytes, remaining);
      controller.enqueue(new Uint8Array(size).fill(0x20));
      bytesEnqueued += size;
    },
    cancel() {
      cancelled = true;
    },
  });
  const headers = new Headers(baseHeaders);
  if (options.contentLength !== undefined) {
    headers.set("Content-Length", options.contentLength);
  }
  const request = new Request(endpoint, {
    method: "POST",
    headers,
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  return {
    request,
    bytesRead: () => bytesEnqueued,
    wasCancelled: () => cancelled,
  };
}

describe("ProjectCEO command route bounded body parsing", () => {
  beforeEach(() => {
    state.executeCalls = 0;
  });

  it("fast-rejects a declared body larger than 96 KiB without reading its stream", async () => {
    const tracked = streamingRequest({
      contentLength: String(MAX_COMMAND_BODY_BYTES + 1),
      totalBytes: MAX_COMMAND_BODY_BYTES + 4096,
    });

    const response = await POST(tracked.request);

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      status: "error",
      error: { code: "validation_failed" },
    });
    expect(tracked.bytesRead()).toBe(0);
    expect(state.executeCalls).toBe(0);
  });

  it.each([
    ["without Content-Length", undefined],
    ["with a lying small Content-Length", "2"],
  ])("bounds stream reads %s and rejects once the decoded body exceeds 96 KiB", async (_label, contentLength) => {
    const chunkBytes = 1024;
    const tracked = streamingRequest({
      contentLength,
      totalBytes: MAX_COMMAND_BODY_BYTES * 3,
      chunkBytes,
    });

    const response = await POST(tracked.request);

    expect(response.status).toBe(413);
    expect(tracked.bytesRead()).toBeLessThanOrEqual(MAX_COMMAND_BODY_BYTES + chunkBytes);
    expect(tracked.wasCancelled()).toBe(true);
    expect(state.executeCalls).toBe(0);
  });

  it("continues to parse and dispatch a valid command below the cap", async () => {
    const response = await POST(new Request(endpoint, {
      method: "POST",
      headers: baseHeaders,
      body: validCommand,
    }));

    expect(response.status).toBe(200);
    expect(state.executeCalls).toBe(1);
  });

  it("returns the existing validation response for malformed JSON below the cap", async () => {
    const response = await POST(new Request(endpoint, {
      method: "POST",
      headers: baseHeaders,
      body: "{",
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      status: "error",
      error: { code: "validation_failed" },
    });
    expect(state.executeCalls).toBe(0);
  });
});
