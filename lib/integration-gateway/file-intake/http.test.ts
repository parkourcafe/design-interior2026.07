import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { boundedFileIntakeRequest } from "./http";

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
