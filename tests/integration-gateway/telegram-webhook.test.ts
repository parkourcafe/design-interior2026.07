import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ingress = vi.hoisted(() => ({
  ingest: vi.fn(async () => ({ accepted: true })),
}));

vi.mock("@/lib/integration-gateway/telegram/runtime", () => ({
  createTelegramWebhookIngress: () => ingress,
}));

import { postTelegramIntegrationWebhook } from "@/lib/integration-gateway/telegram/webhook";

const secret = "telegram-webhook-secret-0123456789";
const update = {
  update_id: 42,
  message: {
    message_id: 7,
    chat: { id: 12345 },
    from: { id: 9 },
    text: "candidate",
  },
};

function request(body: unknown, receivedSecret = secret): Request {
  return new Request("https://staging.example/api/integrations/telegram/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": receivedSecret,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("REMHAOS_TELEGRAM_BRIDGE_ENABLED", "true");
  vi.stubEnv("REMHAOS_TELEGRAM_WORKER_ENABLED", "true");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", secret);
  ingress.ingest.mockClear();
});

afterEach(() => vi.unstubAllEnvs());

describe("Telegram Integration Gateway webhook", () => {
  it("returns 404 while the provider bridge is disabled", async () => {
    vi.stubEnv("REMHAOS_TELEGRAM_BRIDGE_ENABLED", "false");
    const response = await postTelegramIntegrationWebhook(request(update));
    expect(response.status).toBe(404);
    expect(ingress.ingest).not.toHaveBeenCalled();
  });

  it("returns retryable 503 without acknowledging a disabled worker", async () => {
    vi.stubEnv("REMHAOS_TELEGRAM_WORKER_ENABLED", "false");
    const response = await postTelegramIntegrationWebhook(request(update));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "worker_unavailable" } });
    expect(ingress.ingest).not.toHaveBeenCalled();
  });

  it("verifies the secret before reading or ingesting the update", async () => {
    const response = await postTelegramIntegrationWebhook(request(update, "wrong-secret"));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_secret" } });
    expect(ingress.ingest).not.toHaveBeenCalled();
  });

  it("passes the bounded raw update to the worker ingress and returns 202", async () => {
    const response = await postTelegramIntegrationWebhook(request(update));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ accepted: true, updateId: "42" });
    expect(ingress.ingest).toHaveBeenCalledWith({
      rawBody: JSON.stringify(update),
      raw: update,
    });
  });
});
