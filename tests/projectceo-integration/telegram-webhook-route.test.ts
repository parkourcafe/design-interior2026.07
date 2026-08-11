import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * ИСПОЛНЯЕМЫЕ тесты границы webhook: настоящий `Request` → `POST` → `Response`.
 *
 * Прежние проверки читали исходник маршрута регулярками и подтверждали, что
 * нужные слова в файле присутствуют. Такой тест не отличает работающее
 * восстановление от написанного о нём комментария — и не отличил: центральный
 * путь повтора был сломан, а «тесты» были зелёными.
 *
 * Здесь маршрут выполняется. Bot API и порт базы подменены, всё остальное —
 * настоящее: разбор тела, проверка секрета, порядок шагов, коды ответов.
 */

const RPC_STATE = {
  pending: null as null | {
    bindingId: string;
    noticeVersion: string;
    initiatorExternalUserId: number | null;
  },
  activateResult: { projectId: "p1", bindingId: "binding-fresh" } as unknown,
  activateError: null as unknown,
  findError: null as unknown,
  finalizeError: null as unknown,
  ingestResult: { stored: true, duplicate: false } as unknown,
  calls: [] as string[],
  terminated: [] as { bindingId: string; reason: string }[],
};

const BOT_STATE = {
  send: { ok: true, result: { message_id: 5 } } as Record<string, unknown>,
  initiatorAdmin: { ok: true, result: { status: "administrator" } } as Record<string, unknown>,
  botAdmin: { ok: true, result: { status: "administrator" } } as Record<string, unknown>,
  sendCount: 0,
};

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

vi.mock("@/lib/integration-gateway/telegram/channel-port", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/integration-gateway/telegram/channel-port")
  >("@/lib/integration-gateway/telegram/channel-port");
  class FakeSystemPort {
    async findPendingNoticeBinding() {
      RPC_STATE.calls.push("find");
      if (RPC_STATE.findError) throw RPC_STATE.findError;
      return RPC_STATE.pending;
    }
    async activateProjectBinding() {
      RPC_STATE.calls.push("activate");
      if (RPC_STATE.activateError) throw RPC_STATE.activateError;
      return RPC_STATE.activateResult;
    }
    async markChannelNoticePosted() {
      RPC_STATE.calls.push("finalize");
      if (RPC_STATE.finalizeError) throw RPC_STATE.finalizeError;
      return { changed: true };
    }
    async terminatePendingBinding(input: { bindingId: string; reason: string }) {
      RPC_STATE.calls.push("terminate");
      RPC_STATE.terminated.push(input);
      return { terminated: true };
    }
    async ingestChannelUpdate() {
      RPC_STATE.calls.push("ingest");
      return RPC_STATE.ingestResult;
    }
    async suspendProjectBinding() {
      RPC_STATE.calls.push("suspend");
    }
    async consumeIdentityLinkIntent() {
      RPC_STATE.calls.push("consume");
    }
  }
  return { ...actual, TelegramSystemPort: FakeSystemPort };
});

vi.mock("@/lib/integration-gateway/telegram/bot-api", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/integration-gateway/telegram/bot-api")
  >("@/lib/integration-gateway/telegram/bot-api");
  class FakeBotApi {
    async sendMessage() {
      BOT_STATE.sendCount += 1;
      return BOT_STATE.send;
    }
    async getMe() {
      return { ok: true, result: { id: 4242 } };
    }
    async getChatMember(input: { userId: number }) {
      return input.userId === 4242 ? BOT_STATE.botAdmin : BOT_STATE.initiatorAdmin;
    }
  }
  return { ...actual, TelegramBotApi: FakeBotApi };
});

import { POST } from "../../app/api/integrations/telegram/webhook/route";
import { TelegramChannelRpcError } from "../../lib/integration-gateway/telegram/channel-port";

const SECRET = "webhook-secret-value-for-tests-0123456789";
const NONCE = "A".repeat(43);

function webhookRequest(body: unknown, secret: string = SECRET): Request {
  return new Request("https://app.example/api/integrations/telegram/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": secret,
    },
    body: JSON.stringify(body),
  });
}

const groupMessage = (text?: string, updateId = 1) => ({
  update_id: updateId,
  message: {
    message_id: 10,
    date: 1_760_000_000,
    chat: { id: -100500, type: "supergroup" },
    from: { id: 777001 },
    ...(text === undefined ? {} : { text }),
  },
});

const startCommand = (updateId = 1) => groupMessage(`/start ${NONCE}`, updateId);

beforeEach(() => {
  vi.stubEnv("REMHAOS_TELEGRAM_BRIDGE_ENABLED", "true");
  // Идентификатор бота — минимум пять цифр (разбор в `config.ts`).
  vi.stubEnv("TELEGRAM_TEST_BOT_TOKEN", `424242:${"A".repeat(35)}`);
  vi.stubEnv("TELEGRAM_TEST_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("TELEGRAM_TEST_BOT_USERNAME", "remhaos_test_bot");
  RPC_STATE.pending = null;
  RPC_STATE.activateError = null;
  RPC_STATE.findError = null;
  RPC_STATE.finalizeError = null;
  RPC_STATE.activateResult = { projectId: "p1", bindingId: "binding-fresh" };
  RPC_STATE.ingestResult = { stored: true, duplicate: false };
  RPC_STATE.calls = [];
  RPC_STATE.terminated = [];
  BOT_STATE.send = { ok: true, result: { message_id: 5 } };
  BOT_STATE.initiatorAdmin = { ok: true, result: { status: "administrator" } };
  BOT_STATE.botAdmin = { ok: true, result: { status: "administrator" } };
  BOT_STATE.sendCount = 0;
});

afterEach(() => vi.unstubAllEnvs());

describe("Telegram webhook — recovery of a stuck notice_pending binding", () => {
  it("returns 503 when the notice send fails retryably, leaving the binding alive", async () => {
    BOT_STATE.send = { ok: false, failureCode: "tg_429", retryable: true, retryAfterSeconds: 30 };
    const response = await POST(webhookRequest(startCommand()));

    expect(response.status).toBe(503);
    // Связь создана и НЕ терминализирована: повтор обязан её найти.
    expect(RPC_STATE.calls).toContain("activate");
    expect(RPC_STATE.terminated).toEqual([]);
  });

  it("recovers on the SAME /start without consuming the nonce twice", async () => {
    // Первая попытка сорвалась на отправке.
    BOT_STATE.send = { ok: false, failureCode: "network", retryable: true, retryAfterSeconds: 60 };
    expect((await POST(webhookRequest(startCommand(1)))).status).toBe(503);

    // Тот же `/start` приходит снова; связь уже существует.
    RPC_STATE.calls = [];
    RPC_STATE.pending = {
      bindingId: "binding-fresh",
      noticeVersion: "telegram-group-notice/1",
      initiatorExternalUserId: 777001,
    };
    BOT_STATE.send = { ok: true, result: { message_id: 9 } };

    const second = await POST(webhookRequest(startCommand(2)));
    expect(second.status).toBe(200);
    // Ключевое: активация НЕ повторяется — потраченный секрет не трогается.
    expect(RPC_STATE.calls).not.toContain("activate");
    expect(RPC_STATE.calls).toEqual(["find", "finalize"]);
  });

  it("recovers when the send succeeded but finalization failed transiently", async () => {
    RPC_STATE.finalizeError = new TelegramChannelRpcError("mark", "rpc_failed");
    const first = await POST(webhookRequest(startCommand(1)));
    // Сообщение ушло, база не ответила — это НАШ сбой, а не отказ по смыслу.
    expect(first.status).toBe(503);
    expect(RPC_STATE.terminated).toEqual([]);

    RPC_STATE.finalizeError = null;
    RPC_STATE.pending = {
      bindingId: "binding-fresh",
      noticeVersion: "telegram-group-notice/1",
      initiatorExternalUserId: 777001,
    };
    const second = await POST(webhookRequest(startCommand(2)));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ ok: true });
  });

  it("spends an ordinary update on recovery and never ingests it", async () => {
    RPC_STATE.pending = {
      bindingId: "binding-fresh",
      noticeVersion: "telegram-group-notice/1",
      initiatorExternalUserId: 777001,
    };
    const response = await POST(webhookRequest(groupMessage("обычное сообщение", 7)));

    expect(response.status).toBe(200);
    // Участники ещё не предупреждены — сохранять нечего (A7 §6).
    expect(RPC_STATE.calls).not.toContain("ingest");
    expect(RPC_STATE.calls).toEqual(["find", "finalize"]);
  });

  it("checks the pending binding before the /start payload", async () => {
    RPC_STATE.pending = {
      bindingId: "binding-old",
      noticeVersion: "telegram-group-notice/1",
      initiatorExternalUserId: 777001,
    };
    await POST(webhookRequest(startCommand(3)));
    // Порядок: сначала поиск, и активация не зовётся вовсе.
    expect(RPC_STATE.calls[0]).toBe("find");
    expect(RPC_STATE.calls).not.toContain("activate");
  });
});

describe("Telegram webhook — transient failures never become a semantic 200", () => {
  it("returns 503 when the pending lookup fails", async () => {
    RPC_STATE.findError = new TelegramChannelRpcError("find", "rpc_failed");
    const response = await POST(webhookRequest(groupMessage("текст", 11)));
    expect(response.status).toBe(503);
  });

  it("returns 503 when activation fails transiently", async () => {
    RPC_STATE.activateError = new TelegramChannelRpcError("activate", "envelope_invalid");
    const response = await POST(webhookRequest(startCommand(12)));
    expect(response.status).toBe(503);
    expect(RPC_STATE.terminated).toEqual([]);
  });

  it("returns 503 when a membership lookup fails retryably", async () => {
    BOT_STATE.initiatorAdmin = {
      ok: false, failureCode: "timeout", retryable: true, retryAfterSeconds: 60,
    };
    const response = await POST(webhookRequest(startCommand(13)));
    expect(response.status).toBe(503);
    // До отправки дело не дошло: права не подтверждены.
    expect(BOT_STATE.sendCount).toBe(0);
  });

  it("still answers 200 on a genuinely permanent refusal", async () => {
    RPC_STATE.activateError = new TelegramChannelRpcError("activate", "P1109");
    const response = await POST(webhookRequest(startCommand(14)));
    expect(response.status).toBe(200);
  });
});

describe("Telegram webhook — permanent failure terminates the attempt", () => {
  const pending = {
    bindingId: "binding-fresh",
    noticeVersion: "telegram-group-notice/1",
    initiatorExternalUserId: 777001,
  };

  it("terminates and stops re-sending when the initiator was demoted", async () => {
    RPC_STATE.pending = pending;
    BOT_STATE.initiatorAdmin = { ok: true, result: { status: "member" } };

    const response = await POST(webhookRequest(groupMessage("текст", 21)));
    expect(response.status).toBe(200);
    // Уведомление не отправлялось: права проверены ДО отправки.
    expect(BOT_STATE.sendCount).toBe(0);
    expect(RPC_STATE.terminated).toEqual([
      { bindingId: "binding-fresh", reason: "initiator_not_chat_admin" },
    ]);
  });

  it("terminates when the bot itself was demoted", async () => {
    RPC_STATE.pending = pending;
    BOT_STATE.botAdmin = { ok: true, result: { status: "member" } };

    await POST(webhookRequest(groupMessage("текст", 22)));
    expect(BOT_STATE.sendCount).toBe(0);
    expect(RPC_STATE.terminated[0]?.reason).toBe("bot_not_chat_admin");
  });

  it("terminates on a non-retryable Bot API refusal instead of retrying forever", async () => {
    RPC_STATE.pending = pending;
    BOT_STATE.send = { ok: false, failureCode: "tg_403", retryable: false, retryAfterSeconds: 0 };

    const response = await POST(webhookRequest(groupMessage("текст", 23)));
    expect(response.status).toBe(200);
    expect(RPC_STATE.terminated[0]?.reason).toBe("notice_delivery_refused");
  });

  it("terminates when the identity link behind the binding is gone", async () => {
    RPC_STATE.pending = { ...pending, initiatorExternalUserId: null };
    await POST(webhookRequest(groupMessage("текст", 24)));
    expect(RPC_STATE.terminated[0]?.reason).toBe("initiator_identity_revoked");
    expect(BOT_STATE.sendCount).toBe(0);
  });

  it("terminates when finalization is refused permanently", async () => {
    RPC_STATE.pending = pending;
    RPC_STATE.finalizeError = new TelegramChannelRpcError("mark", "P1103");
    const response = await POST(webhookRequest(groupMessage("текст", 25)));
    expect(response.status).toBe(200);
    expect(RPC_STATE.terminated[0]?.reason).toBe("finalization_refused");
  });
});

describe("Telegram webhook — the boundary itself", () => {
  it("refuses a wrong secret before reading the body", async () => {
    const response = await POST(webhookRequest(groupMessage("текст"), "wrong-secret"));
    expect(response.status).toBe(401);
    expect(RPC_STATE.calls).toEqual([]);
  });

  it("is a 404 while the bridge is disabled", async () => {
    vi.stubEnv("REMHAOS_TELEGRAM_BRIDGE_ENABLED", "false");
    const response = await POST(webhookRequest(groupMessage("текст")));
    expect(response.status).toBe(404);
    expect(RPC_STATE.calls).toEqual([]);
  });

  it("ingests only once no binding is waiting for its notice", async () => {
    RPC_STATE.pending = null;
    const response = await POST(webhookRequest(groupMessage("рабочее сообщение", 31)));
    expect(response.status).toBe(200);
    expect(RPC_STATE.calls).toEqual(["find", "ingest"]);
  });
});
