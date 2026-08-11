import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Восстановление незавершённого подключения — на настоящем маршруте.
 *
 * Остальные тесты моста проверяют текст файлов и отдельные функции. Здесь
 * проверяется поведение целиком: HTTP-запрос входит в `POST`, а наружу
 * выходят вызовы Bot API и вызовы RPC — то есть ровно то, что видят Telegram и
 * база. Иначе обещание «следующее событие повторит попытку» осталось бы
 * комментарием: первая редакция этого кода его и содержала, а retry не было.
 *
 * Настоящий здесь и клиент Bot API: подменяется `fetch`, а не класс. Так в
 * сценарий попадает и разбор ответа, и классификация отказа — то, где легче
 * всего разойтись с реальностью.
 */

const BOT_TOKEN = `1234567890:${"A".repeat(35)}`;
const WEBHOOK_SECRET = "s".repeat(40);
const CHAT_ID = -1001234567890;
const INITIATOR_ID = 777001;
// `bot_instance_id` — это и есть числовой идентификатор бота: префикс токена
// до двоеточия. Отдельного `getMe` маршруту поэтому не нужно.
const BOT_USER_ID = 1234567890;
const BINDING_ID = "b1111111-1111-4111-8111-111111111111";
const PROJECT_ID = "41111111-1111-4111-8111-111111111111";

// Ровно та форма, что принимает `digestChannelLinkNonce`: 43 символа
// base64url, то есть 32 байта. Короткая строка вроде «nonce-a» отвергается
// маршрутом ещё до базы — и первая редакция этого файла на ней и падала.
const nonce = (suffix: string): string => "A".repeat(43 - suffix.length) + suffix;

type RpcCall = { readonly operation: string; readonly args: Record<string, unknown> };

interface FakeBridgeOptions {
  /** Активация отказывает — так ведёт себя потраченный nonce. */
  readonly activateFails?: boolean;
  /** Финализация отказывает N раз подряд: сообщение ушло, база не запомнила. */
  readonly finalizeFailures?: number;
}

/**
 * Минимальная модель базы: те же состояния, что и в схеме, и ни одного лишнего.
 * Она не заменяет DB4 — правила живут в SQL и проверяются там; здесь важно
 * только то, ЧТО и В КАКОМ ПОРЯДКЕ зовёт транспорт.
 */
function createFakeBridge(options: FakeBridgeOptions = {}) {
  const calls: RpcCall[] = [];
  const state = {
    binding: null as null | { status: "notice_pending" | "active" },
    storedEvents: 0,
    finalizeFailuresLeft: options.finalizeFailures ?? 0,
  };

  const envelope = (data: unknown) => ({
    contractVersion: "remhaos-channel/0.1",
    requestId: "db:test",
    data,
    error: null,
  });

  const client = {
    schema(name: string) {
      expect(name).toBe("remhaos_channel_api");
      return {
        async rpc(operation: string, args: Record<string, unknown>) {
          calls.push({ operation, args });
          switch (operation) {
            case "activate_project_binding": {
              if (options.activateFails) {
                return { data: null, error: { code: "P1103" } };
              }
              state.binding = { status: "notice_pending" };
              return {
                data: envelope({
                  bindingId: BINDING_ID,
                  projectId: PROJECT_ID,
                  status: "notice_pending",
                  captureState: "none",
                }),
                error: null,
              };
            }
            case "find_pending_notice_binding": {
              if (state.binding?.status !== "notice_pending") {
                return { data: envelope({ pending: false }), error: null };
              }
              return {
                data: envelope({
                  pending: true,
                  bindingId: BINDING_ID,
                  noticeVersion: "notice-v1",
                  initiatorExternalUserId: INITIATOR_ID,
                }),
                error: null,
              };
            }
            case "mark_channel_notice_posted": {
              // Оба администраторства обязательны и проверяются в RPC — здесь
              // модель повторяет её отказ, иначе тест доказывал бы поведение
              // базы, которой нет.
              if (
                args.initiator_is_chat_admin !== true
                || args.bot_is_chat_admin !== true
              ) {
                return { data: null, error: { code: "P1103" } };
              }
              if (state.finalizeFailuresLeft > 0) {
                state.finalizeFailuresLeft -= 1;
                return { data: null, error: { code: "P1112" } };
              }
              state.binding = { status: "active" };
              return {
                data: envelope({ bindingId: BINDING_ID, status: "active", changed: true }),
                error: null,
              };
            }
            case "ingest_channel_update": {
              // Приём открыт ТОЛЬКО у активной связи — как и в схеме.
              if (state.binding?.status !== "active") {
                return {
                  data: envelope({ stored: false, reason: "capture_not_open" }),
                  error: null,
                };
              }
              state.storedEvents += 1;
              return {
                data: envelope({ stored: true, duplicate: false, eventId: "e1" }),
                error: null,
              };
            }
            default:
              return { data: envelope({}), error: null };
          }
        },
      };
    },
  };

  return { client, calls, state };
}

interface BotScript {
  noticeFailures: number;
  initiatorStatus: string;
  botStatus: string;
  sentMessages: number;
}

function installTelegramFetch(script: BotScript): void {
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const respond = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    if (url.endsWith("/getMe")) {
      return respond({ ok: true, result: { id: BOT_USER_ID } });
    }
    if (url.endsWith("/getChatMember")) {
      // Кого спрашивают, видно из тела запроса. Считать вызовы по порядку было
      // бы догадкой о реализации: маршрут вправе поменять порядок, и тест
      // начал бы отвечать «администратор» не тому.
      const body = JSON.parse(String(init?.body ?? "{}")) as { user_id?: number };
      const status = body.user_id === BOT_USER_ID
        ? script.botStatus
        : script.initiatorStatus;
      return respond({ ok: true, result: { status } });
    }
    if (url.endsWith("/sendMessage")) {
      if (script.noticeFailures > 0) {
        script.noticeFailures -= 1;
        return respond({ ok: false, error_code: 429, parameters: { retry_after: 5 } });
      }
      script.sentMessages += 1;
      return respond({ ok: true, result: { message_id: 55 } });
    }
    throw new Error(`unexpected telegram call: ${url}`);
  });
}

function adminStatuses(initiator: string, bot: string): BotScript {
  return { noticeFailures: 0, initiatorStatus: initiator, botStatus: bot, sentMessages: 0 };
}

function handshakeUpdate(updateId: number, nonce: string): unknown {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_760_000_000,
      chat: { id: CHAT_ID, type: "supergroup" },
      from: { id: INITIATOR_ID },
      text: `/start ${nonce}`,
    },
  };
}

function ordinaryUpdate(updateId: number, text: string): unknown {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_760_000_000,
      chat: { id: CHAT_ID, type: "supergroup" },
      from: { id: INITIATOR_ID },
      text,
    },
  };
}

function webhookRequest(update: unknown, secret = WEBHOOK_SECRET): Request {
  return new Request("https://remhaos.test/api/integrations/telegram/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": secret,
    },
    body: JSON.stringify(update),
  });
}

async function loadRoute(bridge: ReturnType<typeof createFakeBridge>) {
  vi.resetModules();
  vi.doMock("@/lib/supabase/admin", () => ({
    createAdminClient: () => bridge.client,
  }));
  return import("@/app/api/integrations/telegram/webhook/route");
}

/** Исходы моста читаются из его же структурного лога — другого выхода нет. */
function captureOutcomes(): { readonly outcomes: string[]; restore: () => void } {
  const outcomes: string[] = [];
  const info = vi.spyOn(console, "info").mockImplementation((line: unknown) => {
    const parsed = JSON.parse(String(line)) as { readonly outcome?: string };
    if (parsed.outcome) outcomes.push(parsed.outcome);
  });
  const error = vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    const parsed = JSON.parse(String(line)) as { readonly outcome?: string };
    if (parsed.outcome) outcomes.push(parsed.outcome);
  });
  return { outcomes, restore: () => { info.mockRestore(); error.mockRestore(); } };
}

describe("Telegram notice recovery", () => {
  beforeEach(() => {
    process.env.REMHAOS_TELEGRAM_BRIDGE_ENABLED = "true";
    process.env.TELEGRAM_TEST_BOT_TOKEN = BOT_TOKEN;
    process.env.TELEGRAM_TEST_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.TELEGRAM_TEST_BOT_USERNAME = "remhaos_test_bot";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("@/lib/supabase/admin");
    delete process.env.REMHAOS_TELEGRAM_BRIDGE_ENABLED;
    delete process.env.TELEGRAM_TEST_BOT_TOKEN;
    delete process.env.TELEGRAM_TEST_WEBHOOK_SECRET;
    delete process.env.TELEGRAM_TEST_BOT_USERNAME;
  });

  it("leaves capture closed when the notice fails, then opens it on the next update", async () => {
    const bridge = createFakeBridge();
    const script = adminStatuses("creator", "administrator");
    script.noticeFailures = 1;
    installTelegramFetch(script);
    const route = await loadRoute(bridge);
    const log = captureOutcomes();

    // Рукопожатие: связь создана, уведомление НЕ ушло. Ответ 503, а не 200:
    // ретраибельный отказ Telegram — наш незакрытый вопрос, и «разобрались»
    // здесь было бы ложью, после которой событие теряется молча.
    const first = await route.POST(webhookRequest(handshakeUpdate(1, nonce("a"))));
    expect(first.status).toBe(503);
    expect(bridge.state.binding?.status).toBe("notice_pending");
    expect(bridge.calls.some((c) => c.operation === "mark_channel_notice_posted")).toBe(false);

    // Обычное сообщение до успешного уведомления. Оно чинит подключение — и
    // при этом само НЕ сохраняется: участников предупредили только сейчас.
    const second = await route.POST(webhookRequest(ordinaryUpdate(2, "рабочий вопрос")));
    log.restore();

    expect(second.status).toBe(200);
    expect(bridge.state.binding?.status).toBe("active");
    expect(bridge.state.storedEvents).toBe(0);
    expect(log.outcomes).toEqual(["internal_error", "binding_activated"]);

    // Приём этого сообщения вообще не вызывался: событие потрачено на
    // починку, а не на сохранение чужой переписки до предупреждения.
    expect(bridge.calls.some((c) => c.operation === "ingest_channel_update")).toBe(false);
  });

  it("recovers when Telegram accepted the notice but the database did not", async () => {
    // Худший из транзиентных отказов: сообщение в чате уже есть, а связь всё
    // ещё закрыта. Единственная цена восстановления — второе сообщение в чат.
    const bridge = createFakeBridge({ finalizeFailures: 1 });
    const script = adminStatuses("creator", "administrator");
    installTelegramFetch(script);
    const route = await loadRoute(bridge);
    const log = captureOutcomes();

    // Сообщение ушло, база его не запомнила — это наш сбой, и 503 просит
    // Telegram вернуться. 200 здесь потерял бы связь до случайного сообщения.
    const first = await route.POST(webhookRequest(handshakeUpdate(3, nonce("b"))));
    expect(first.status).toBe(503);
    expect(bridge.state.binding?.status).toBe("notice_pending");
    expect(script.sentMessages).toBe(1);

    const second = await route.POST(webhookRequest(ordinaryUpdate(4, "второй заход")));
    log.restore();

    expect(second.status).toBe(200);
    expect(bridge.state.binding?.status).toBe("active");
    expect(bridge.state.storedEvents).toBe(0);
    expect(script.sentMessages).toBe(2);
    expect(log.outcomes).toEqual(["internal_error", "binding_activated"]);
  });

  it("finds the pending binding again without spending a second nonce", async () => {
    // Повтор `/start` по потраченному токену. Активация обязана отказать —
    // одноразовость не обсуждается, — а подключение всё равно доводится до
    // конца, потому что незавершённая связь ищется по чату, а не по nonce.
    const bridge = createFakeBridge();
    const script = adminStatuses("creator", "administrator");
    script.noticeFailures = 1;
    installTelegramFetch(script);
    const route = await loadRoute(bridge);
    const log = captureOutcomes();

    await route.POST(webhookRequest(handshakeUpdate(5, nonce("c"))));
    expect(bridge.state.binding?.status).toBe("notice_pending");

    // Второе рукопожатие: сервер отвечает отказом на потраченный токен.
    bridge.calls.length = 0;
    const bridgeWithSpentNonce = createFakeBridge({ activateFails: true });
    bridgeWithSpentNonce.state.binding = { status: "notice_pending" };
    const retryRoute = await loadRoute(bridgeWithSpentNonce);
    const retryScript = adminStatuses("creator", "administrator");
    installTelegramFetch(retryScript);

    const repeat = await retryRoute.POST(webhookRequest(handshakeUpdate(6, nonce("c"))));
    log.restore();

    expect(repeat.status).toBe(200);
    expect(bridgeWithSpentNonce.state.binding?.status).toBe("active");
    const operations = bridgeWithSpentNonce.calls.map((call) => call.operation);
    expect(operations).toEqual([
      "activate_project_binding",
      "find_pending_notice_binding",
      "mark_channel_notice_posted",
    ]);
  });

  it("keeps capture closed when the bot lost its administrator rights meanwhile", async () => {
    // Между созданием связи и публикацией уведомления бота понизили. Ни
    // сообщения, ни финализации: связь остаётся восстановимой, а не открытой.
    const bridge = createFakeBridge();
    bridge.state.binding = { status: "notice_pending" };
    const script = adminStatuses("creator", "member");
    installTelegramFetch(script);
    const route = await loadRoute(bridge);
    const log = captureOutcomes();

    const response = await route.POST(webhookRequest(ordinaryUpdate(7, "пока ждём")));
    log.restore();

    expect(response.status).toBe(200);
    expect(bridge.state.binding?.status).toBe("notice_pending");
    expect(bridge.state.storedEvents).toBe(0);
    expect(script.sentMessages).toBe(0);
    expect(bridge.calls.some((c) => c.operation === "mark_channel_notice_posted")).toBe(false);
    expect(log.outcomes).toEqual(["binding_notice_pending"]);
  });

  it("passes freshly fetched administrator facts into the finalizing RPC", async () => {
    const bridge = createFakeBridge();
    bridge.state.binding = { status: "notice_pending" };
    const script = adminStatuses("creator", "administrator");
    installTelegramFetch(script);
    const route = await loadRoute(bridge);
    const log = captureOutcomes();

    await route.POST(webhookRequest(ordinaryUpdate(8, "чиним")));
    log.restore();

    const finalize = bridge.calls.find((c) => c.operation === "mark_channel_notice_posted");
    expect(finalize).toBeDefined();
    // Оба факта обязательны и утвердительны — иначе RPC откажет сама.
    expect(finalize?.args.initiator_is_chat_admin).toBe(true);
    expect(finalize?.args.bot_is_chat_admin).toBe(true);
    expect(finalize?.args.binding_id).toBe(BINDING_ID);
  });
});
