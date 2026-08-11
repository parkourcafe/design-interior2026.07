import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { sanitizeBridgeEvent, sanitizeFailureCode } from "@/lib/integration-gateway/telegram/bridge-log";
import type { ClaimedNotification, TelegramSystemPort } from "@/lib/integration-gateway/telegram/gateway-port";
import {
  retryDelaySeconds,
  runTelegramNotificationWorker,
} from "@/lib/integration-gateway/telegram/notification-runner";
import { releaseDeepLink, releaseNotificationTemplate } from "@/lib/integration-gateway/telegram/release-notification";
import { TelegramApi, TelegramApiError } from "@/lib/integration-gateway/telegram/telegram-api";
import {
  extractStartToken,
  normalizeTelegramUpdate,
  suspendsBinding,
  TELEGRAM_MAX_DOWNLOAD_BYTES,
} from "@/lib/integration-gateway/telegram/update-schema";
import {
  handleTelegramUpdate,
  secretMatches,
  TELEGRAM_NOTICE_VERSION,
} from "@/lib/integration-gateway/telegram/webhook-service";
import { deriveChannelStatus } from "@/components/projectceo/telegram-channel-panel";

const CHAT = "-1001000000001";
const BOT = "telegram:remhaostestbot";

function messageUpdate(overrides: Record<string, unknown> = {}): unknown {
  return {
    update_id: 501,
    message: {
      message_id: 42,
      date: 1_800_000_000,
      chat: { id: Number(CHAT), type: "supergroup" },
      from: { id: 770001, is_bot: false },
      text: "Нужно заменить плитку в санузле на другую модель",
      ...overrides,
    },
  };
}

describe("Telegram update normalization", () => {
  it("normalizes a group message into a first source revision", () => {
    const result = normalizeTelegramUpdate(messageUpdate());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.update.kind).toBe("message");
    expect(result.update.externalChatId).toBe(CHAT);
    expect(result.update.externalActorId).toBe("770001");
    expect(result.update.sourceRevision).toBe(1);
    expect(result.update.textContent).toContain("плитку");
  });

  /**
   * Правка — ВТОРАЯ ревизия того же источника, а не перезапись. Это единственное
   * место, где номер ревизии рождается, и ошибиться здесь значит тихо потерять
   * исходный текст, на который человек уже мог сослаться.
   */
  it("gives an edited message the second source revision, not the first", () => {
    const result = normalizeTelegramUpdate({
      update_id: 502,
      edited_message: {
        message_id: 42,
        date: 1_800_000_100,
        chat: { id: Number(CHAT), type: "supergroup" },
        from: { id: 770001 },
        text: "Нужно заменить плитку в санузле на керамогранит",
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.update.kind).toBe("edited_message");
    expect(result.update.externalMessageId).toBe(42);
    expect(result.update.sourceRevision).toBe(2);
  });

  it("accepts an unknown extra field instead of refusing the whole update", () => {
    // Telegram добавляет поля без предупреждения. Падать от нового поля значит
    // перестать принимать переписку в день, когда его добавят.
    const result = normalizeTelegramUpdate(messageUpdate({ brand_new_field: { a: 1 } }));
    expect(result.ok).toBe(true);
  });

  it("separates a malformed body from an authentic but unsupported update", () => {
    expect(normalizeTelegramUpdate({ nonsense: true })).toMatchObject({
      ok: false,
      reason: "malformed",
    });
    expect(normalizeTelegramUpdate({ update_id: 7, poll: { id: "x" } })).toMatchObject({
      ok: false,
      reason: "unsupported",
    });
  });

  /**
   * Файл крупнее лимита Bot API не «медленно скачается» — он не скачается
   * никогда. Решение принимается по объявленному размеру ДО попытки, и это не
   * доверие к метаданным: фактический размер сервер всё равно считает сам.
   */
  it("marks an oversized attachment before any download attempt", () => {
    const result = normalizeTelegramUpdate(messageUpdate({
      text: undefined,
      caption: "Смета",
      document: {
        file_id: "doc-1",
        file_unique_id: "uniq-1",
        file_size: TELEGRAM_MAX_DOWNLOAD_BYTES + 1,
        mime_type: "application/pdf",
      },
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.update.attachments).toHaveLength(1);
    expect(result.update.attachments[0]!.initialScanStatus).toBe("too_large");
    expect(result.update.attachments[0]!.initialScanReason).toBe("exceeds_bot_api_limit");
  });

  it("keeps one attachment for the photo ladder Telegram sends", () => {
    const result = normalizeTelegramUpdate(messageUpdate({
      text: undefined,
      photo: [
        { file_id: "small", file_unique_id: "u-small", file_size: 100 },
        { file_id: "large", file_unique_id: "u-large", file_size: 9000 },
      ],
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.update.attachments).toHaveLength(1);
    expect(result.update.attachments[0]!.externalFileId).toBe("large");
  });

  it("treats every loss of bot standing as a reason to suspend", () => {
    for (const status of ["left", "kicked", "restricted", "member"]) {
      expect(suspendsBinding(status), status).toBe(true);
    }
    expect(suspendsBinding("administrator")).toBe(false);
    expect(suspendsBinding("creator")).toBe(false);
  });

  it("reads a start token only in the shape Telegram can actually deliver", () => {
    expect(extractStartToken("/start abcdefghijklmnopqrst")).toBe("abcdefghijklmnopqrst");
    expect(extractStartToken("/start@RemHaOSTestBot abcdefghijklmnopqrst"))
      .toBe("abcdefghijklmnopqrst");
    // Алфавит ограничен ровно тем, что разрешает Telegram.
    expect(extractStartToken("/start плитка!!!")).toBeNull();
    expect(extractStartToken("обычное сообщение")).toBeNull();
    expect(extractStartToken(null)).toBeNull();
  });
});

describe("webhook secret", () => {
  it("rejects a missing and a forged secret alike", () => {
    expect(secretMatches("a".repeat(48), null)).toBe(false);
    expect(secretMatches("a".repeat(48), "b".repeat(48))).toBe(false);
    expect(secretMatches("a".repeat(48), "a".repeat(48))).toBe(true);
  });
});

/** Порт-двойник: считает вызовы и позволяет подменить исход. */
function fakePort(overrides: Partial<Record<keyof TelegramSystemPort, unknown>> = {}) {
  const calls: string[] = [];
  const base = {
    resolveBinding: async () => {
      calls.push("resolveBinding");
      return {
        bindingId: "11111111-1111-4111-8111-111111111111",
        organizationId: "22222222-2222-4222-8222-222222222222",
        projectId: "33333333-3333-4333-8333-333333333333",
        status: "active" as const,
        captureMode: "full_after_notice" as const,
      };
    },
    recordEvent: async () => {
      calls.push("recordEvent");
      return {
        eventId: "44444444-4444-4444-8444-444444444444",
        duplicate: false,
        projectId: "33333333-3333-4333-8333-333333333333",
      };
    },
    recordAttachment: async () => {
      calls.push("recordAttachment");
      return { attachmentId: null, duplicate: false };
    },
    suspendBinding: async () => {
      calls.push("suspendBinding");
      return { bindingId: "x", status: "suspended" };
    },
    markNoticePosted: async () => {
      calls.push("markNoticePosted");
      return { bindingId: "x", captureMode: "full_after_notice" };
    },
    consumeIntent: async () => {
      calls.push("consumeIntent");
      throw new Error("not used");
    },
  };
  return { port: { ...base, ...overrides } as unknown as TelegramSystemPort, calls };
}

function fakeApi(sent: string[] = []): TelegramApi {
  return {
    sendMessage: async ({ text }: { text: string }) => {
      sent.push(text);
      return { messageId: 1 };
    },
    isChatAdministrator: async () => true,
  } as unknown as TelegramApi;
}

const noticeDeps = {
  botInstanceId: BOT,
  webhookSecret: "s".repeat(48),
  noticeText: "notice",
  unboundChatText: "unbound",
  logger: { emit() {} },
};

describe("webhook ingest", () => {
  it("records an authentic group message and answers 2xx", async () => {
    const { port, calls } = fakePort();
    const outcome = await handleTelegramUpdate(
      messageUpdate(), { ...noticeDeps, port, api: fakeApi() }, "req-1",
    );
    expect(outcome.status).toBe("accepted");
    expect(calls).toContain("recordEvent");
  });

  /**
   * Повтор доставки — норма для Telegram: он повторяет, пока не получит 2xx.
   * Второй раз обязан попасть в ТУ ЖЕ строку, иначе одно сообщение строителя
   * породило бы столько кандидатов, сколько было ретраев.
   */
  it("reports a repeated update as a duplicate, still 2xx", async () => {
    const { port } = fakePort({
      recordEvent: async () => ({
        eventId: "44444444-4444-4444-8444-444444444444",
        duplicate: true,
        projectId: "33333333-3333-4333-8333-333333333333",
      }),
    });
    const outcome = await handleTelegramUpdate(
      messageUpdate(), { ...noticeDeps, port, api: fakeApi() }, "req-2",
    );
    expect(outcome).toMatchObject({ status: "accepted", duplicate: true });
  });

  /**
   * Несвязанный чат: содержимое не сохраняется вовсе, и бот сообщает, что
   * подключение не завершено. Ровно один ответ, дальше тишина.
   */
  it("stores nothing from an unbound chat", async () => {
    const sent: string[] = [];
    const { port, calls } = fakePort({ resolveBinding: async () => null });
    const outcome = await handleTelegramUpdate(
      {
        update_id: 9,
        my_chat_member: {
          chat: { id: -100999, type: "supergroup" },
          from: { id: 770001 },
          date: 1_800_000_000,
          new_chat_member: { status: "administrator" },
        },
      },
      { ...noticeDeps, port, api: fakeApi(sent) },
      "req-3",
    );
    expect(outcome).toMatchObject({ status: "ignored", code: "chat_not_bound" });
    expect(calls).not.toContain("recordEvent");
    expect(sent).toEqual(["unbound"]);
  });

  it("suspends the binding when the bot loses its standing", async () => {
    const { port, calls } = fakePort();
    const outcome = await handleTelegramUpdate(
      {
        update_id: 10,
        my_chat_member: {
          chat: { id: Number(CHAT), type: "supergroup" },
          from: { id: 770001 },
          date: 1_800_000_000,
          new_chat_member: { status: "kicked" },
        },
      },
      { ...noticeDeps, port, api: fakeApi() },
      "req-4",
    );
    expect(outcome).toMatchObject({ status: "ignored", code: "binding_suspended" });
    expect(calls).toContain("suspendBinding");
  });

  /**
   * Приём не начинается, пока участники не уведомлены. Порядок обратный —
   * сначала объявить, потом слушать — и он не декоративный.
   */
  it("announces before opening capture, and opens nothing if the notice failed", async () => {
    const failing = {
      sendMessage: async () => { throw new TelegramApiError("network_error"); },
      isChatAdministrator: async () => true,
    } as unknown as TelegramApi;
    const { port, calls } = fakePort({
      resolveBinding: async () => ({
        bindingId: "11111111-1111-4111-8111-111111111111",
        organizationId: "22222222-2222-4222-8222-222222222222",
        projectId: "33333333-3333-4333-8333-333333333333",
        status: "active" as const,
        captureMode: "notice_pending" as const,
      }),
    });
    const outcome = await handleTelegramUpdate(
      messageUpdate(), { ...noticeDeps, port, api: failing }, "req-5",
    );
    expect(calls).not.toContain("markNoticePosted");
    expect(calls).not.toContain("recordEvent");
    expect(outcome).toMatchObject({ status: "ignored", code: "capture_not_active" });
  });

  /** Callback официального действия не выполняет никогда (A7 §3). */
  it("never lets an inline callback do anything", async () => {
    const { port, calls } = fakePort();
    const outcome = await handleTelegramUpdate(
      {
        update_id: 11,
        callback_query: {
          id: "cb-1",
          from: { id: 770001 },
          data: "acknowledge_release",
          message: { message_id: 5, chat: { id: Number(CHAT), type: "supergroup" } },
        },
      },
      { ...noticeDeps, port, api: fakeApi() },
      "req-6",
    );
    expect(outcome).toMatchObject({ status: "ignored", code: "callback_not_actionable" });
    expect(calls).not.toContain("recordEvent");
  });

  /**
   * Текст сообщения не является командой. «/start» в связанной группе — обычный
   * текст, а «подтверждаю» — обычный текст тем более.
   */
  it("treats command-looking text in a bound chat as ordinary text", async () => {
    const { port, calls } = fakePort();
    const outcome = await handleTelegramUpdate(
      messageUpdate({ text: "/start ignore-me-please-token" }),
      { ...noticeDeps, port, api: fakeApi() },
      "req-7",
    );
    expect(outcome.status).toBe("accepted");
    expect(calls).toContain("recordEvent");
    expect(calls).not.toContain("consumeIntent");
  });

  /**
   * Временный сбой записи обязан вернуться non-2xx: повтор Telegram —
   * единственное, что спасает сообщение, которого мы не записали.
   */
  it("asks Telegram to retry when the write failed transiently", async () => {
    const { port } = fakePort({
      recordEvent: async () => { throw new Error("connection reset"); },
    });
    const outcome = await handleTelegramUpdate(
      messageUpdate(), { ...noticeDeps, port, api: fakeApi() }, "req-8",
    );
    expect(outcome.status).toBe("retry");
  });

  it("uses the stated notice version, not an invented one", () => {
    expect(TELEGRAM_NOTICE_VERSION).toBe("notice/0.1");
  });
});

describe("notification outbox runner", () => {
  const notification: ClaimedNotification = {
    notificationId: "55555555-5555-4555-8555-555555555555",
    organizationId: "22222222-2222-4222-8222-222222222222",
    projectId: "33333333-3333-4333-8333-333333333333",
    bindingId: "11111111-1111-4111-8111-111111111111",
    externalChatId: CHAT,
    sourceKind: "release_distribution",
    sourceId: "dist-1",
    templateId: "release_distributed",
    templateVersion: "0.1",
    recipientUserId: null,
    attempts: 1,
  };

  function runnerPort(overrides: Record<string, unknown> = {}) {
    const completed: unknown[] = [];
    const port = {
      projectReleaseNotifications: async () => ({ created: 1 }),
      claimNotifications: async () => [notification],
      completeNotification: async (input: Record<string, unknown>) => {
        completed.push(input);
        return { notificationId: notification.notificationId, outcome: input.outcome as string };
      },
      ...overrides,
    } as unknown as TelegramSystemPort;
    return { port, completed };
  }

  it("projects first, then sends — an empty queue is a safe no-op", async () => {
    const { port } = runnerPort({
      projectReleaseNotifications: async () => ({ created: 0 }),
      claimNotifications: async () => [],
    });
    const result = await runTelegramNotificationWorker({
      port,
      api: fakeApi(),
      template: releaseNotificationTemplate("https://remhaos.test"),
      logger: { emit() {} },
    });
    expect(result).toMatchObject({ projected: 0, claimed: 0, sent: 0 });
  });

  it("sends the notification and records the Telegram message id", async () => {
    const { port, completed } = runnerPort();
    const result = await runTelegramNotificationWorker({
      port,
      api: fakeApi(),
      template: releaseNotificationTemplate("https://remhaos.test"),
      logger: { emit() {} },
    });
    expect(result.sent).toBe(1);
    expect(completed[0]).toMatchObject({ outcome: "sent", externalMessageId: 1 });
  });

  /**
   * `429 retry_after` соблюдается РОВНО. Удвоить его от себя значит превратить
   * вежливый лимит Telegram в собственный простой.
   */
  it("honours retry_after exactly instead of doubling it", async () => {
    const throttled = {
      sendMessage: async () => { throw new TelegramApiError("rate_limited", 17, 429); },
    } as unknown as TelegramApi;
    const { port, completed } = runnerPort();
    const result = await runTelegramNotificationWorker({
      port,
      api: throttled,
      template: releaseNotificationTemplate("https://remhaos.test"),
      logger: { emit() {} },
    });
    expect(result.retried).toBe(1);
    expect(completed[0]).toMatchObject({ outcome: "retry", retryAfterSeconds: 17 });
  });

  it("stops retrying after the attempt ceiling instead of circling forever", async () => {
    const failing = {
      sendMessage: async () => { throw new TelegramApiError("upstream_error", null, 502); },
    } as unknown as TelegramApi;
    const { port, completed } = runnerPort({
      claimNotifications: async () => [{ ...notification, attempts: 99 }],
    });
    const result = await runTelegramNotificationWorker({
      port,
      api: failing,
      template: releaseNotificationTemplate("https://remhaos.test"),
      logger: { emit() {} },
      maxAttempts: 8,
    });
    expect(result.failed).toBe(1);
    expect(completed[0]).toMatchObject({ outcome: "failed" });
  });

  /** Отозванная привязка отменяет отправку — и это не ошибка воркера. */
  it("accepts a cancelled outcome from the database as a normal result", async () => {
    const { port } = runnerPort({
      completeNotification: async () => ({
        notificationId: notification.notificationId,
        outcome: "cancelled",
      }),
    });
    const result = await runTelegramNotificationWorker({
      port,
      api: fakeApi(),
      template: releaseNotificationTemplate("https://remhaos.test"),
      logger: { emit() {} },
    });
    expect(result.cancelled).toBe(1);
    expect(result.sent).toBe(0);
  });

  it("adds jitter and never exceeds an hour", () => {
    for (const attempts of [1, 3, 10, 50]) {
      const delay = retryDelaySeconds(attempts, () => 0.99);
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(3600);
    }
    expect(retryDelaySeconds(1, () => 0)).toBe(60);
  });
});

describe("release notification content", () => {
  const notification: ClaimedNotification = {
    notificationId: "55555555-5555-4555-8555-555555555555",
    organizationId: "22222222-2222-4222-8222-222222222222",
    projectId: "33333333-3333-4333-8333-333333333333",
    bindingId: "11111111-1111-4111-8111-111111111111",
    externalChatId: CHAT,
    sourceKind: "release_distribution",
    sourceId: "dist-secret-id",
    templateId: "release_distributed",
    templateVersion: "0.1",
    recipientUserId: "66666666-6666-4666-8666-666666666666",
    attempts: 0,
  };

  /**
   * В группу уходит факт и ссылка — и ничего больше. Пакет, signed URL, бюджет и
   * внутренние идентификаторы в чат не попадают (A7 §1.3).
   */
  it("carries the fact and the link, and nothing that could leak", () => {
    const rendered = releaseNotificationTemplate("https://remhaos.test/")
      .render(notification);
    expect(rendered).not.toBeNull();
    const text = rendered!.text;
    expect(text).toContain("новая версия");
    expect(text).toContain("https://remhaos.test/dashboard/projectceo/projects/");
    expect(text).not.toContain("dist-secret-id");
    expect(text).not.toContain(notification.recipientUserId!);
    expect(text).not.toMatch(/token|signature|X-Amz|budget|руб/i);
  });

  it("says plainly that a chat message is not an acknowledgement", () => {
    const text = releaseNotificationTemplate("https://remhaos.test").render(notification)!.text;
    expect(text).toContain("подтверждением не является");
  });

  it("refuses to render a template it does not own", () => {
    expect(releaseNotificationTemplate("https://remhaos.test").render({
      ...notification,
      templateId: "something_else",
    })).toBeNull();
  });

  it("builds an ordinary protected link with no token in it", () => {
    const link = releaseDeepLink("https://remhaos.test", "33333333-3333-4333-8333-333333333333");
    expect(link).toBe(
      "https://remhaos.test/dashboard/projectceo/projects/33333333-3333-4333-8333-333333333333",
    );
    expect(link).not.toContain("?");
  });
});

describe("sanitized diagnostics", () => {
  /**
   * Главная проверка правила из A7 §7: ни строки переписки, ни имени файла, ни
   * токена, ни секрета, ни download URL в логах. Здесь это ловится тем, что
   * поля просто отбрасываются.
   */
  it("drops anything that is not an identifier, a code or a number", () => {
    const event = sanitizeBridgeEvent({
      event: "webhook_accepted",
      requestId: "44444444-4444-4444-8444-444444444444",
      projectId: "not-a-uuid",
      code: "Нужно заменить плитку" as unknown as string,
      updateKind: "message",
      updateId: 7,
    });
    expect(event).toEqual({
      channel: "telegram",
      event: "webhook_accepted",
      requestId: "44444444-4444-4444-8444-444444444444",
      updateKind: "message",
      updateId: 7,
    });
    expect(JSON.stringify(event)).not.toContain("плитку");
  });

  it("turns a foreign failure into a code and keeps its message out", () => {
    const secretUrl = "https://api.telegram.org/bot123456:AA-SECRET/getFile";
    expect(sanitizeFailureCode(new Error(secretUrl))).toBe("unknown_failure");
    expect(sanitizeFailureCode({ code: "P1103" })).toBe("p1103");
    expect(sanitizeFailureCode({ code: "forbidden" })).toBe("forbidden");
    expect(JSON.stringify(sanitizeBridgeEvent({
      event: "webhook_dead_letter",
      code: sanitizeFailureCode(new Error(secretUrl)),
    }))).not.toContain("SECRET");
  });

  it("never carries an external chat or actor identifier", () => {
    const serialized = JSON.stringify(sanitizeBridgeEvent({
      event: "webhook_accepted",
      updateId: 1,
    }));
    expect(serialized).not.toContain(CHAT);
    expect(serialized).not.toContain("770001");
  });
});

describe("Telegram API client", () => {
  it("never puts the bot token into the error it throws", async () => {
    const api = new TelegramApi({
      botToken: "123456:AA-SUPER-SECRET",
      fetchImpl: (async () => {
        throw new Error("connect ECONNREFUSED https://api.telegram.org/bot123456:AA-SUPER-SECRET");
      }) as unknown as typeof fetch,
    });
    await expect(api.sendMessage({ chatId: CHAT, text: "x" })).rejects.toSatisfy(
      (error: unknown) => {
        const serialized = `${(error as Error).message}${(error as Error).stack ?? ""}`;
        return error instanceof TelegramApiError && !serialized.includes("AA-SUPER-SECRET");
      },
    );
  });

  it("separates a rate limit from a permanent rejection", async () => {
    const respond = (status: number, body: unknown) => (async () => new Response(
      JSON.stringify(body), { status, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;

    const limited = new TelegramApi({
      botToken: "t",
      fetchImpl: respond(429, { ok: false, parameters: { retry_after: 12 } }),
    });
    await expect(limited.sendMessage({ chatId: CHAT, text: "x" })).rejects.toMatchObject({
      code: "rate_limited",
      retryAfterSeconds: 12,
    });

    const rejected = new TelegramApi({
      botToken: "t",
      fetchImpl: respond(400, { ok: false, error_code: 400, description: "chat not found" }),
    });
    await expect(rejected.sendMessage({ chatId: CHAT, text: "x" })).rejects.toMatchObject({
      code: "request_rejected_400",
    });
  });

  it("returns only the relative file path, never a download URL", async () => {
    const api = new TelegramApi({
      botToken: "123456:AA-SUPER-SECRET",
      fetchImpl: (async () => new Response(
        JSON.stringify({ ok: true, result: { file_path: "documents/file_1.pdf" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch,
    });
    const path = await api.getFilePath("file-1");
    expect(path).toBe("documents/file_1.pdf");
    expect(path).not.toContain("api.telegram.org");
    expect(path).not.toContain("AA-SUPER-SECRET");
  });

  it("drops updates that piled up before the webhook existed", async () => {
    const seen: unknown[] = [];
    const api = new TelegramApi({
      botToken: "t",
      fetchImpl: (async (_url: string, init: RequestInit) => {
        seen.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch,
    });
    await api.setWebhook({
      url: "https://remhaos.test/api/integrations/telegram/webhook",
      secretToken: "s".repeat(48),
      allowedUpdates: ["message"],
    });
    // История до подключения не импортируется (A7 §5.3) — и это выражено
    // параметром, а не намерением.
    expect(seen[0]).toMatchObject({ drop_pending_updates: true });
  });
});

describe("channel panel states", () => {
  const binding = {
    bindingId: "11111111-1111-4111-8111-111111111111",
    provider: "telegram",
    chatType: "supergroup",
    status: "active" as const,
    captureMode: "full_after_notice",
    noticeVersion: "notice/0.1",
    noticePostedAt: "2026-08-11T10:00:00Z",
    createdAt: "2026-08-11T09:00:00Z",
    activatedAt: "2026-08-11T09:30:00Z",
    statusReason: null,
  };

  it("asks for the account link before anything else", () => {
    expect(deriveChannelStatus({ binding: null, identity: { linked: false } }, false))
      .toBe("identity_required");
  });

  it("separates 'no chat' from 'link sent, waiting'", () => {
    expect(deriveChannelStatus({ binding: null, identity: { linked: true } }, false))
      .toBe("not_connected");
    expect(deriveChannelStatus({ binding: null, identity: { linked: true } }, true))
      .toBe("awaiting_confirmation");
  });

  /**
   * Бот в группе, но уведомление не опубликовано — это ещё НЕ приём. Показать
   * здесь «активен» значило бы соврать участникам чата.
   */
  it("does not call a pre-notice binding active", () => {
    expect(deriveChannelStatus({
      binding: { ...binding, captureMode: "notice_pending" },
      identity: { linked: true },
    }, false)).toBe("choose_group");
  });

  it("names the missing bot rights instead of a generic suspension", () => {
    expect(deriveChannelStatus({
      binding: { ...binding, status: "suspended", statusReason: "bot_membership_lost" },
      identity: { linked: true },
    }, false)).toBe("bot_needs_rights");
    expect(deriveChannelStatus({
      binding: { ...binding, status: "suspended", statusReason: "other_reason" },
      identity: { linked: true },
    }, false)).toBe("suspended");
  });

  it("reports an active binding as active", () => {
    expect(deriveChannelStatus({ binding, identity: { linked: true } }, false)).toBe("active");
  });
});

describe("connect link shape", () => {
  /**
   * Секрет — 32 случайных байта в base64url. 43 символа помещаются в лимит
   * Telegram (64) вместе с алфавитом, который он разрешает.
   */
  it("fits a 32-byte secret into the Telegram start parameter", () => {
    const secret = Buffer.from(new Uint8Array(32).fill(7)).toString("base64url");
    expect(secret).toHaveLength(43);
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(`https://t.me/bot?startgroup=${secret}`.length).toBeLessThan(200);
    // В базу уходит только хеш.
    expect(createHash("sha256").update(secret).digest("hex")).toMatch(/^[0-9a-f]{64}$/);
  });
});
