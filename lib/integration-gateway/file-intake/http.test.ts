import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { boundedFileIntakeRequest, fileIntakeErrorResponse } from "./http";
import { mapRpcError } from "@/lib/project-intelligence/adapters/postgres/errors";

function chunkedBody(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("File Intake multipart boundary", () => {
  it.each([
    ["P1209", "scope_conflict", 409, '{"reason":"CLEAN_SCAN_REQUIRED"}'],
    ["P1204", "not_found", 404, '{"entity":"publishable_file_intake"}'],
  ] as const)("preserves %s without exposing private database details", async (code, expected, status, details) => {
    const response = fileIntakeErrorResponse(mapRpcError({ code, details }));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({
      error: { code: expected, messageKey: `project_ceo.error.${expected}` },
    });
  });

  it("keeps an unknown database error fail-closed", async () => {
    const response = fileIntakeErrorResponse(mapRpcError({ code: "XX999", details: "private source location" }));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("private source location");
  });

  it("rejects chunked bodies after the configured byte cap", async () => {
    const request = new Request("http://127.0.0.1/file-intakes", {
      method: "POST",
      body: chunkedBody(["1234", "56"]),
      duplex: "half",
    } as RequestInit & { readonly duplex: "half" });

    await expect(
      boundedFileIntakeRequest(request, 5).arrayBuffer(),
    ).rejects.toThrow("file_intake_request_validation_failed");
  });

  it("preserves an under-limit chunked body", async () => {
    const request = new Request("http://127.0.0.1/file-intakes", {
      method: "POST",
      body: chunkedBody(["12", "34"]),
      duplex: "half",
    } as RequestInit & { readonly duplex: "half" });

    const bytes = new Uint8Array(
      await boundedFileIntakeRequest(request, 5).arrayBuffer(),
    );
    expect(new TextDecoder().decode(bytes)).toBe("1234");
  });
});
