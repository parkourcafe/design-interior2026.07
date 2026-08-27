import { describe, expect, it, vi } from "vitest";
import { TelegramProviderError, TelegramProviderTransport } from "./provider-transport";

const raw = {
  update_id: 9001,
  message: {
    message_id: 7,
    chat: { id: 12345 },
    from: { id: 42 },
    document: {
      file_id: "telegram-file-id",
      file_name: "plan.pdf",
      mime_type: "application/pdf",
      file_size: 9,
    },
  },
};

describe("Telegram provider transport", () => {
  it("resolves provider file metadata and returns quarantine-ready bytes", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { file_path: "documents/plan.pdf" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response("%PDF-1.7\n", { status: 200 }));
    const update = {
      updateId: "9001",
      chatId: "12345",
      messageId: "7",
      senderId: "42",
      textDigest: null,
      attachments: [{
        providerFileIdDigest: "unused",
        displayName: "plan.pdf",
        mediaType: "application/pdf",
        sizeBytes: 9,
      }],
    } as const;
    const [attachment] = await new TelegramProviderTransport("telegram-bot-token-123456", fetchImpl)
      .downloadAttachments({
        raw,
        update,
        organizationId: "11111111-1111-4111-8111-111111111111",
        projectId: "22222222-2222-4222-8222-222222222222",
      });
    expect(attachment?.displayName).toBe("plan.pdf");
    expect(attachment?.checksumHex).toMatch(/^[a-f0-9]{64}$/u);
    expect(attachment?.quarantineObjectKey).toContain("/quarantine/telegram/");
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("getFile");
  });

  it("fails closed for missing credentials and oversized files", async () => {
    expect(() => new TelegramProviderTransport(undefined)).toThrow(TelegramProviderError);
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { file_path: "documents/plan.pdf" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response("", { status: 200, headers: { "content-length": "52428801" } }));
    const update = {
      updateId: "9001",
      chatId: "12345",
      messageId: "7",
      senderId: "42",
      textDigest: null,
      attachments: [{ providerFileIdDigest: "unused", displayName: "plan.pdf", mediaType: "application/pdf", sizeBytes: 9 }],
    } as const;
    await expect(new TelegramProviderTransport("telegram-bot-token-123456", fetchImpl).downloadAttachments({
      raw,
      update,
      organizationId: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
    })).rejects.toThrow("file_too_large");
  });
});
