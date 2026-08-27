import { describe, expect, it } from "vitest";
import { normalizeTelegramUpdate } from "./contracts";
import {
  parseTelegramBody,
  readTelegramBody,
  TelegramWebhookError,
  verifyTelegramWebhookSecret,
} from "./security";

describe("Telegram staging boundary", () => {
  it("uses constant-time secret comparison and bounded JSON parsing", () => {
    expect(() => verifyTelegramWebhookSecret("wrong", "0123456789abcdef")).toThrow(
      TelegramWebhookError,
    );
    expect(parseTelegramBody('{"update_id":1}')).toEqual({ update_id: 1 });
    expect(() => parseTelegramBody("x".repeat(256 * 1024 + 1))).toThrow(
      TelegramWebhookError,
    );
  });

  it("keeps raw chat text and provider file IDs out of the normalized projection", () => {
    const update = normalizeTelegramUpdate({
      update_id: 44,
      message: {
        message_id: 7,
        chat: { id: -100123 },
        from: { id: 8 },
        text: "private project message",
        document: { file_id: "provider-file-1", file_name: "plan.pdf", mime_type: "application/pdf" },
      },
    });
    expect(update.chatId).toBe("-100123");
    expect(update.textDigest).toHaveLength(64);
    expect(update.attachments[0]?.providerFileIdDigest).toHaveLength(64);
    expect(JSON.stringify(update)).not.toContain("private project message");
    expect(JSON.stringify(update)).not.toContain("provider-file-1");
  });

  it("bounds the request stream before parsing the Telegram payload", async () => {
    await expect(readTelegramBody(new Request("http://127.0.0.1/telegram", {
      method: "POST",
      body: "x".repeat(256 * 1024 + 1),
    }))).rejects.toThrow("body_too_large");
    await expect(readTelegramBody(new Request("http://127.0.0.1/telegram", {
      method: "POST",
      body: "{\"update_id\":1}",
    }))).resolves.toBe('{"update_id":1}');
  });
});
