import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  botInstanceIdFromToken,
  readTelegramCredentials,
  readTelegramStagingChatId,
} from "../../lib/integration-gateway/telegram/config";
import {
  isAuthenticTelegramWebhook,
  TELEGRAM_WEBHOOK_SECRET_HEADER,
} from "../../lib/integration-gateway/telegram/webhook-auth";
import {
  createChannelLinkNonce,
  digestChannelLinkNonce,
} from "../../lib/integration-gateway/telegram/link-nonce";
import {
  groupBindingUrl,
  identityLinkUrl,
  manualStartCommand,
} from "../../lib/integration-gateway/telegram/deep-link";
import {
  isGroupChat,
  normalizeTelegramUpdate,
  telegramUpdateSchema,
} from "../../lib/integration-gateway/telegram/update-contract";
import {
  isChatAdministrator,
  TelegramBotApi,
  extractSentMessageId,
} from "../../lib/integration-gateway/telegram/bot-api";
import {
  NOTIFICATION_TEMPLATE_VERSION,
  renderNotification,
} from "../../lib/integration-gateway/telegram/notification-template";
import { runTelegramNotificationBatch } from "../../lib/integration-gateway/telegram/notification-runner";
import { chatRef, logTelegramBridgeEvent } from "../../lib/integration-gateway/telegram/observability";
import type { TelegramSystemPort } from "../../lib/integration-gateway/telegram/channel-port";

const repoRoot = process.cwd();
const read = (path: string): string => readFileSync(join(repoRoot, path), "utf8");

// Похож на настоящий по форме и не является ничьим ключом: цифры и буквы
// придуманы здесь. Настоящий токен в репозитории не появляется ни в каком виде.
const SHAPED_TOKEN = `1234567890:${"A".repeat(35)}`;

describe("Telegram credentials", () => {
  it("treats a missing variable as an unconfigured bridge, naming only the variable", () => {
    const result = readTelegramCredentials({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing).toContain("TELEGRAM_TEST_BOT_TOKEN");
    expect(result.missing).toContain("TELEGRAM_TEST_WEBHOOK_SECRET");
  });

  it("refuses a token of the wrong shape instead of passing junk to the database", () => {
    // `bot_instance_id` идёт в базу и по нему сопоставляются связи. Мусор в
    // нём означал бы связь, которую невозможно отнести к боту.
    expect(botInstanceIdFromToken("not-a-token")).toBeNull();
    expect(botInstanceIdFromToken("")).toBeNull();
    expect(botInstanceIdFromToken(SHAPED_TOKEN)).toBe("1234567890");
  });

  it("derives the bot instance id from the token, not from a second variable", () => {
    const result = readTelegramCredentials({
      TELEGRAM_TEST_BOT_TOKEN: SHAPED_TOKEN,
      TELEGRAM_TEST_WEBHOOK_SECRET: "s".repeat(40),
      TELEGRAM_TEST_BOT_USERNAME: "@remhaos_test_bot",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.credentials.botInstanceId).toBe("1234567890");
    // Ведущая собака `@` в username — самый частый способ ввести его руками.
    expect(result.credentials.botUsername).toBe("remhaos_test_bot");
  });

  it("keeps the staging chat id optional, because only TG4 depends on it", () => {
    expect(readTelegramStagingChatId({})).toBeNull();
    expect(readTelegramStagingChatId({ TELEGRAM_TEST_CHAT_ID: "abc" })).toBeNull();
    expect(
      readTelegramStagingChatId({ TELEGRAM_TEST_CHAT_ID: "-1001234567890" }),
    ).toBe(-1001234567890);
  });
});

describe("Webhook authenticity", () => {
  const secret = "correct-horse-battery-staple-correct-horse";

  it("accepts only the exact secret", () => {
    expect(isAuthenticTelegramWebhook(secret, secret)).toBe(true);
    expect(isAuthenticTelegramWebhook(`${secret}x`, secret)).toBe(false);
    expect(isAuthenticTelegramWebhook(secret.slice(0, -1), secret)).toBe(false);
  });

  it("refuses a missing header exactly as it refuses a wrong one", () => {
    // Разные ответы подсказывали бы, настроен ли секрет вообще.
    expect(isAuthenticTelegramWebhook(null, secret)).toBe(false);
    expect(isAuthenticTelegramWebhook(undefined, secret)).toBe(false);
    expect(isAuthenticTelegramWebhook("", secret)).toBe(false);
  });

  it("refuses everything when no secret is configured", () => {
    // Пустой ожидаемый секрет обязан закрывать дверь, а не открывать её всем.
    expect(isAuthenticTelegramWebhook("", "")).toBe(false);
    expect(isAuthenticTelegramWebhook("anything", "")).toBe(false);
  });

  it("names the header in the casing Request.headers.get expects", () => {
    expect(TELEGRAM_WEBHOOK_SECRET_HEADER).toBe("x-telegram-bot-api-secret-token");
  });
});

describe("One-time link secret", () => {
  it("hands the database a digest and never the secret", () => {
    const issued = createChannelLinkNonce();
    expect(issued.digest).toMatch(/^\\x[0-9a-f]{64}$/);
    expect(issued.digest).not.toContain(issued.nonce);
    // Дайджест — именно sha256 от БАЙТОВ секрета, а не от его base64-записи:
    // база сверяет то же самое.
    const expected = createHash("sha256")
      .update(Buffer.from(issued.nonce, "base64url"))
      .digest("hex");
    expect(issued.digest).toBe(`\\x${expected}`);
  });

  it("produces a payload Telegram deep links actually accept", () => {
    // Алфавит payload у Telegram — A-Za-z0-9_- и не длиннее 64 символов.
    for (let index = 0; index < 50; index += 1) {
      expect(createChannelLinkNonce().nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it("does not repeat itself", () => {
    const seen = new Set(Array.from({ length: 200 }, () => createChannelLinkNonce().nonce));
    expect(seen.size).toBe(200);
  });

  it("rejects anything that merely looks like a secret", () => {
    // Webhook принимает текст из интернета: «похоже на nonce» не значит «им является».
    expect(digestChannelLinkNonce("")).toBeNull();
    expect(digestChannelLinkNonce("../../etc/passwd")).toBeNull();
    expect(digestChannelLinkNonce("A".repeat(42))).toBeNull();
    expect(digestChannelLinkNonce("A".repeat(64))).toBeNull();
    expect(digestChannelLinkNonce(randomBytes(32).toString("base64url"))).not.toBeNull();
  });

  it("verifies a presented secret to the same digest it issued", () => {
    const issued = createChannelLinkNonce();
    expect(digestChannelLinkNonce(issued.nonce)).toBe(issued.digest);
  });
});

describe("Deep links", () => {
  it("builds the two documented shapes", () => {
    expect(identityLinkUrl("remhaos_bot", "abc")).toBe("https://t.me/remhaos_bot?start=abc");
    expect(groupBindingUrl("remhaos_bot", "abc")).toBe("https://t.me/remhaos_bot?startgroup=abc");
    expect(manualStartCommand("abc")).toBe("/start abc");
  });

  it("refuses a username that would break the URL", () => {
    // Username приходит из окружения. Подставленный без проверки, он
    // превращает ссылку в чужой адрес.
    expect(() => identityLinkUrl("evil.com/x", "abc")).toThrow();
    expect(() => identityLinkUrl("", "abc")).toThrow();
    expect(() => groupBindingUrl("bad name", "abc")).toThrow();
  });
});

describe("Update normalization", () => {
  const message = (over: Record<string, unknown> = {}) => ({
    update_id: 12,
    message: {
      message_id: 7,
      date: 1_760_000_000,
      chat: { id: -100500, type: "supergroup" },
      from: { id: 4242 },
      ...over,
    },
  });

  it("keeps an unknown update kind out of the pipeline without failing", () => {
    // Telegram расширяет Update. Падать на новом поле значит просить его
    // повторять доставку вечно.
    const parsed = telegramUpdateSchema.parse({ update_id: 1, poll_answer: {} });
    expect(normalizeTelegramUpdate(parsed)).toBeNull();
  });

  it("reads the handshake payload in both group and private forms", () => {
    const withText = (text: string) =>
      normalizeTelegramUpdate(telegramUpdateSchema.parse(message({ text })));
    expect(withText("/start abc123")?.startPayload).toBe("abc123");
    expect(withText("/start@remhaos_bot abc123")?.startPayload).toBe("abc123");
    expect(withText("  /start abc123  ")?.startPayload).toBe("abc123");
  });

  it("treats ordinary text as content, never as a command", () => {
    // A7 §2.1: мост не исполняет команды из текста. Всё, кроме рукопожатия,
    // обязано остаться просто текстом.
    for (const text of [
      "/start",
      "/acknowledge_release",
      "/create_change now",
      "подтверждаю получение",
      "start abc123",
    ]) {
      const event = normalizeTelegramUpdate(telegramUpdateSchema.parse(message({ text })));
      expect(event?.startPayload, text).toBeNull();
    }
  });

  it("carries an edit as a separate event rather than a rewrite", () => {
    const edited = normalizeTelegramUpdate(
      telegramUpdateSchema.parse({
        update_id: 13,
        edited_message: {
          message_id: 7,
          chat: { id: -100500, type: "supergroup" },
          from: { id: 4242 },
          text: "поправил",
        },
      }),
    );
    expect(edited?.kind).toBe("edited_message");
    expect(edited?.messageId).toBe(7);
  });

  it("marks the bot's removal so the binding can be suspended", () => {
    for (const status of ["left", "kicked", "banned"]) {
      const event = normalizeTelegramUpdate(
        telegramUpdateSchema.parse({
          update_id: 14,
          my_chat_member: {
            chat: { id: -100500, type: "supergroup" },
            new_chat_member: { status },
          },
        }),
      );
      expect(event?.botRemoved, status).toBe(true);
    }
    const stillMember = normalizeTelegramUpdate(
      telegramUpdateSchema.parse({
        update_id: 15,
        my_chat_member: {
          chat: { id: -100500, type: "supergroup" },
          new_chat_member: { status: "administrator" },
        },
      }),
    );
    expect(stillMember?.botRemoved).toBe(false);
  });

  it("survives a source timestamp it should not trust", () => {
    // Время приходит от источника. `new Date` на мусоре молча даёт Invalid Date,
    // и в базу ушло бы «время», которого не бывает.
    for (const date of [-1, 99_999_999_999, Number.MAX_SAFE_INTEGER]) {
      const event = normalizeTelegramUpdate(telegramUpdateSchema.parse(message({ date })));
      expect(event?.sentAt, String(date)).toBeNull();
    }
    expect(
      normalizeTelegramUpdate(telegramUpdateSchema.parse(message({ date: 1_760_000_000 })))?.sentAt,
    ).toBe(new Date(1_760_000_000_000).toISOString());
  });

  it("takes the largest photo size and the claimed metadata as claimed", () => {
    const event = normalizeTelegramUpdate(
      telegramUpdateSchema.parse(
        message({
          photo: [
            { file_id: "small", file_unique_id: "u1", file_size: 100 },
            { file_id: "large", file_unique_id: "u2", file_size: 9000 },
          ],
        }),
      ),
    );
    expect(event?.attachments).toHaveLength(1);
    expect(event?.attachments[0]?.fileId).toBe("large");
    expect(event?.attachments[0]?.claimedSizeBytes).toBe(9000);
  });

  it("separates group chats from private ones", () => {
    expect(isGroupChat("group")).toBe(true);
    expect(isGroupChat("supergroup")).toBe(true);
    expect(isGroupChat("private")).toBe(false);
    expect(isGroupChat("channel")).toBe(false);
  });
});

describe("Bot API client", () => {
  const capturedUrls: string[] = [];
  const fakeFetch = (body: unknown, status = 200): typeof fetch =>
    (async (url: string | URL | Request) => {
      capturedUrls.push(String(url));
      return {
        status,
        json: async () => body,
      } as unknown as Response;
    }) as unknown as typeof fetch;

  it("classifies a permanent refusal as not retryable", () => {
    // 403 — бота выкинули. Повтор не изменит ничего и займёт очередь навсегда.
    return (async () => {
      const api = new TelegramBotApi(SHAPED_TOKEN, fakeFetch({ ok: false, error_code: 403 }));
      const outcome = await api.sendMessage({ chatId: -1, text: "x" });
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.retryable).toBe(false);
      expect(outcome.failureCode).toBe("tg_403");
    })();
  });

  it("obeys the pause Telegram itself names on 429", async () => {
    const api = new TelegramBotApi(
      SHAPED_TOKEN,
      fakeFetch({ ok: false, error_code: 429, parameters: { retry_after: 47 } }),
    );
    const outcome = await api.sendMessage({ chatId: -1, text: "x" });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.retryable).toBe(true);
    expect(outcome.retryAfterSeconds).toBe(47);
  });

  it("never lets the provider's own text out of the client", async () => {
    // `description` может содержать кусок отправленного текста.
    const api = new TelegramBotApi(
      SHAPED_TOKEN,
      fakeFetch({ ok: false, error_code: 400, description: "Bad Request: секретный текст" }),
    );
    const outcome = await api.sendMessage({ chatId: -1, text: "x" });
    expect(JSON.stringify(outcome)).not.toContain("секретный");
    expect(JSON.stringify(outcome)).not.toContain(SHAPED_TOKEN);
  });

  it("puts the token in the request URL and nowhere else", async () => {
    capturedUrls.length = 0;
    const api = new TelegramBotApi(SHAPED_TOKEN, fakeFetch({ ok: true, result: { message_id: 5 } }));
    const outcome = await api.sendMessage({ chatId: -1, text: "x" });
    expect(capturedUrls[0]).toContain(SHAPED_TOKEN);
    expect(JSON.stringify(outcome)).not.toContain(SHAPED_TOKEN);
    expect(extractSentMessageId(outcome.ok ? outcome.result : null)).toBe(5);
  });

  it("counts only owners and administrators as able to connect a chat", () => {
    expect(isChatAdministrator({ status: "creator" })).toBe(true);
    expect(isChatAdministrator({ status: "administrator" })).toBe(true);
    expect(isChatAdministrator({ status: "member" })).toBe(false);
    expect(isChatAdministrator({ status: "restricted" })).toBe(false);
    expect(isChatAdministrator(null)).toBe(false);
    expect(isChatAdministrator({})).toBe(false);
  });
});

describe("Notification rendering", () => {
  const payload = {
    kind: "release_distributed",
    projectId: "41111111-1111-4111-8111-111111111111",
    versionLabel: "v3",
  };

  it("puts no access token in a link that lands in a group chat", () => {
    const rendered = renderNotification({
      templateVersion: NOTIFICATION_TEMPLATE_VERSION,
      payload,
      appBaseUrl: "https://example.test/",
    });
    expect(rendered?.text).toContain(
      "https://example.test/dashboard/projectceo/projects/41111111-1111-4111-8111-111111111111",
    );
    // Ссылка видна всем участникам группы. Токен в ней означал бы доступ по
    // факту членства в чужом чате.
    expect(rendered?.text).not.toMatch(/token|share|[?&]t=/i);
  });

  it("refuses to send anything for a payload it does not understand", () => {
    expect(
      renderNotification({
        templateVersion: NOTIFICATION_TEMPLATE_VERSION,
        payload: { kind: "something_else" },
        appBaseUrl: "https://example.test",
      }),
    ).toBeNull();
    expect(
      renderNotification({
        templateVersion: "telegram-notice/999",
        payload,
        appBaseUrl: "https://example.test",
      }),
    ).toBeNull();
  });

  it("carries the event and the link, not the contents of the project", () => {
    const rendered = renderNotification({
      templateVersion: NOTIFICATION_TEMPLATE_VERSION,
      payload,
      appBaseUrl: "https://example.test",
    });
    expect(rendered?.text.split("\n").length).toBeLessThanOrEqual(4);
  });
});

describe("Notification runner", () => {
  interface Recorded {
    readonly sent: string[];
    readonly failed: { readonly id: string; readonly code: string }[];
  }

  const fakePort = (
    claimed: readonly Record<string, unknown>[],
    recorded: Recorded,
  ): TelegramSystemPort =>
    ({
      claimNotificationBatch: async () => claimed,
      markNotificationSent: async (input: { readonly notificationId: string }) => {
        recorded.sent.push(input.notificationId);
      },
      markNotificationFailed: async (input: {
        readonly notificationId: string;
        readonly failureCode: string;
      }) => {
        recorded.failed.push({ id: input.notificationId, code: input.failureCode });
      },
    }) as unknown as TelegramSystemPort;

  const claimed = (over: Record<string, unknown> = {}) => ({
    notificationId: "n1",
    bindingId: "b1",
    templateVersion: NOTIFICATION_TEMPLATE_VERSION,
    attemptCount: 1,
    payload: {
      kind: "release_distributed",
      projectId: "41111111-1111-4111-8111-111111111111",
    },
    externalChatId: -100500,
    botInstanceId: "1234567890",
    ...over,
  });

  it("is a safe no-op on an empty queue", async () => {
    const recorded: Recorded = { sent: [], failed: [] };
    const result = await runTelegramNotificationBatch(
      fakePort([], recorded),
      { sendMessage: async () => ({ ok: true, result: {} }) },
      { appBaseUrl: "https://example.test" },
    );
    expect(result).toEqual({ claimed: 0, sent: 0, failed: 0, skipped: 0 });
    expect(recorded.sent).toEqual([]);
  });

  it("marks a lost response as failed, so it is retried rather than lost", async () => {
    const recorded: Recorded = { sent: [], failed: [] };
    const result = await runTelegramNotificationBatch(
      fakePort([claimed()], recorded),
      {
        sendMessage: async () => ({
          ok: false,
          failureCode: "network",
          retryable: true,
          retryAfterSeconds: 60,
        }),
      },
      { appBaseUrl: "https://example.test" },
    );
    expect(result.failed).toBe(1);
    expect(recorded.failed[0]?.code).toBe("network");
  });

  it("does not retry a template it will never understand", async () => {
    const recorded: Recorded = { sent: [], failed: [] };
    const result = await runTelegramNotificationBatch(
      fakePort([claimed({ templateVersion: "telegram-notice/999" })], recorded),
      {
        sendMessage: async () => {
          throw new Error("must not be called");
        },
      },
      { appBaseUrl: "https://example.test" },
    );
    expect(result.skipped).toBe(1);
    expect(recorded.failed[0]?.code).toBe("template_unknown");
  });

  it("reports what it sent", async () => {
    const recorded: Recorded = { sent: [], failed: [] };
    const result = await runTelegramNotificationBatch(
      fakePort([claimed(), claimed({ notificationId: "n2" })], recorded),
      { sendMessage: async () => ({ ok: true, result: { message_id: 9 } }) },
      { appBaseUrl: "https://example.test" },
    );
    expect(result).toEqual({ claimed: 2, sent: 2, failed: 0, skipped: 0 });
    expect(recorded.sent).toEqual(["n1", "n2"]);
  });
});

describe("Structured logs", () => {
  it("hashes the chat identifier instead of printing it", () => {
    const reference = chatRef(-100500);
    expect(reference).toMatch(/^[0-9a-f]{12}$/);
    expect(reference).not.toContain("100500");
    // Стабилен: строки одного чата сопоставимы между собой.
    expect(chatRef(-100500)).toBe(reference);
    expect(chatRef(-100501)).not.toBe(reference);
  });

  it("has no field that could carry message text", () => {
    // Приём — список разрешённого, а не чистка запрещённого: чистильщик
    // ошибается на поле, о котором не знал.
    const source = read("lib/integration-gateway/telegram/observability.ts");
    const shape = source.slice(
      source.indexOf("export interface TelegramBridgeLogEvent"),
      source.indexOf("/** Короткий стабильный хеш"),
    );
    for (const forbidden of ["text", "payload", "message", "fileName", "url", "token"]) {
      expect(shape.toLowerCase(), forbidden).not.toContain(`${forbidden.toLowerCase()}?:`);
    }
  });

  it("emits one JSON line and nothing else", () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "info").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    logTelegramBridgeEvent({ outcome: "stored", requestId: "r1", updateId: 5 });
    spy.mockRestore();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toEqual({
      scope: "telegram-bridge",
      outcome: "stored",
      requestId: "r1",
      updateId: 5,
    });
  });
});

/**
 * Инварианты, которые обязаны держаться по построению кода, а не по
 * дисциплине автора. Каждый из них — про то, что нельзя проверить одним
 * взглядом на диф.
 */
describe("Transport invariants", () => {
  const webhook = read("app/api/integrations/telegram/webhook/route.ts");
  const humanRoute = read("app/api/integrations/telegram/channel/route.ts");

  it("gives the webhook no human RPC and no domain command", () => {
    // A7 §2.1: звать человеческую RPC через service_role запрещено. Маршрут
    // держит только системный порт, и человеческих методов у того нет.
    expect(webhook).toContain("TelegramSystemPort");
    expect(webhook).not.toContain("TelegramHumanPort");
    for (const forbidden of [
      "projectceo_product_api",
      "projectceo_m4_api",
      "ProjectCeoCommandService",
      "createProjectCeoRequestContext",
    ]) {
      expect(webhook, forbidden).not.toContain(forbidden);
    }
  });

  it("gives the human route no system port and no service-role client", () => {
    expect(humanRoute).toContain("TelegramHumanPort");
    expect(humanRoute).not.toContain("TelegramSystemPort");
    expect(humanRoute).not.toContain("createAdminClient");
  });

  it("checks the flag and the secret before it reads the body", () => {
    // Сравниваются места ВЫЗОВОВ, а не импортов: импорты стоят в алфавитном
    // порядке сборщика и о порядке проверок ничего не говорят.
    const body = webhook.slice(webhook.indexOf("export async function POST"));
    const flagAt = body.indexOf("isTelegramBridgeEnabled()");
    const secretAt = body.indexOf("isAuthenticTelegramWebhook(");
    const bodyAt = body.indexOf("readBoundedBody(request)");
    for (const [name, at] of [["flag", flagAt], ["secret", secretAt], ["body", bodyAt]] as const) {
      expect(at, name).toBeGreaterThan(-1);
    }
    // Порядок — часть контракта: иначе дорогая работа делается на чужой байт.
    expect(flagAt).toBeLessThan(secretAt);
    expect(secretAt).toBeLessThan(bodyAt);
  });

  it("lets the bot token reach the API client and nothing else", () => {
    // Маршрут ОБЯЗАН передать токен клиенту Bot API — иначе отправлять нечем.
    // Проверяется не «слова botToken нет», а то, что он не утекает никуда
    // ещё: ни в лог, ни в ответ, ни в состояние экрана.
    const uses = webhook.match(/botToken/g) ?? [];
    expect(uses.length).toBe(1);
    expect(webhook).toContain("new TelegramBotApi(credentials.credentials.botToken)");

    for (const path of [
      "app/api/integrations/telegram/channel/route.ts",
      "components/projectceo/telegram-channel-panel.tsx",
      "lib/integration-gateway/telegram/observability.ts",
      "lib/integration-gateway/telegram/notification-runner.ts",
      "lib/integration-gateway/telegram/channel-port.ts",
    ]) {
      expect(read(path), path).not.toContain("botToken");
    }
    // Панель — клиентский компонент. Ни одной серверной переменной в ней.
    expect(read("components/projectceo/telegram-channel-panel.tsx"))
      .not.toContain("process.env");
  });

  it("uses the exact wording A7 fixed for the connect action", () => {
    // Bot API не позволяет боту создать группу. Обещать «создадим чат» —
    // обещать то, чего платформа не даёт, поэтому текст закреплён документом.
    expect(read("lib/i18n/ru.ts")).toContain("Создать или подключить Telegram-чат");
    const addendum = read(
      "docs/canonical/remhaos-v1/REMHAOS_ADDENDUM_A7_TELEGRAM_CHAT_BRIDGE.md",
    );
    expect(addendum).toContain("Создать или подключить Telegram-чат");
  });

  it("keeps every interface string out of the components", () => {
    const panel = read("components/projectceo/telegram-channel-panel.tsx");
    expect(panel).toContain('from "@/lib/i18n/ru"');
    // Кириллица в компоненте допустима только в комментариях.
    const withoutComments = panel
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(withoutComments).not.toMatch(/["'`][^"'`]*[а-яА-ЯёЁ][^"'`]*["'`]/);
  });
});
