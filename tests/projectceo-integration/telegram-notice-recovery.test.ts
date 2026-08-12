import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * НАСТОЯЩИЙ порт и НАСТОЯЩИЙ клиент Bot API на пути `Request → POST →
 * Response`.
 *
 * Соседний файл (`telegram-webhook-route.test.ts`) подменяет порт классом и
 * проверяет порядок шагов маршрута. Здесь подменяются только два внешних мира —
 * клиент Postgres и `fetch`, — поэтому в сценарий попадает то, что там
 * подменено: разбор конверта, схемы ответов, классификация отказов Telegram.
 * Ровно там и живут ошибки вида «нарушение контракта свернулось в `null`».
 *
 * ИДЕНТИФИКАТОРЫ АКТИВАЦИИ И ПОИСКА НАМЕРЕННО РАЗНЫЕ. Совпади они — тест
 * проходил бы и тогда, когда маршрут после вставки ищет «текущую ожидающую»
 * вместо возвращённого идентификатора, и доказывал бы ровно ничего.
 */

const BOT_TOKEN = `1234567890:${"A".repeat(35)}`;
const WEBHOOK_SECRET = "s".repeat(40);
const CHAT_ID = -1001234567890;
const INITIATOR_ID = 777001;
// `bot_instance_id` — префикс токена до двоеточия, он же идентификатор бота.
const BOT_USER_ID = 1234567890;
const ACTIVATED_BINDING = "a1111111-1111-4111-8111-111111111111";
const LOOKUP_BINDING = "b2222222-2222-4222-8222-222222222222";
const PROJECT_ID = "41111111-1111-4111-8111-111111111111";

// Ровно та форма, что принимает `digestChannelLinkNonce`: 43 символа base64url.
const nonce = (suffix: string): string => "A".repeat(43 - suffix.length) + suffix;

type RpcCall = { readonly operation: string; readonly args: Record<string, unknown> };

interface FakeBridgeOptions {
  readonly activateFailure?: string;
  readonly finalizeFailure?: string;
  readonly lookupPayload?: unknown;
  readonly finalizePayload?: unknown;
  readonly terminatePayload?: unknown;
}

/**
 * Модель базы отвечает КОНВЕРТАМИ, а не готовыми объектами: именно так её
 * видит порт, и именно на этом стыке ломается контракт.
 */
function createFakeBridge(options: FakeBridgeOptions = {}) {
  const calls: RpcCall[] = [];
  const state = {
    binding: null as null | {
      status: "notice_pending" | "active" | "suspended" | "revoked";
      reason?: string;
      disposition?: string;
    },
    storedEvents: 0,
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
              if (options.activateFailure) {
                return { data: null, error: { code: options.activateFailure } };
              }
              state.binding = { status: "notice_pending" };
              return {
                data: envelope({
                  bindingId: ACTIVATED_BINDING,
                  projectId: PROJECT_ID,
                  status: "notice_pending",
                  captureState: "none",
                }),
                error: null,
              };
            }
            case "find_pending_notice_binding": {
              if (options.lookupPayload !== undefined) {
                return { data: envelope(options.lookupPayload), error: null };
              }
              if (state.binding?.status !== "notice_pending") {
                return { data: envelope({ pending: false }), error: null };
              }
              // НАРОЧНО другой идентификатор.
              return {
                data: envelope({
                  pending: true,
                  bindingId: LOOKUP_BINDING,
                  noticeVersion: "notice-v1",
                  initiatorExternalUserId: INITIATOR_ID,
                }),
                error: null,
              };
            }
            case "mark_channel_notice_posted": {
              if (options.finalizePayload !== undefined) {
                return { data: envelope(options.finalizePayload), error: null };
              }
              if (options.finalizeFailure) {
                return { data: null, error: { code: options.finalizeFailure } };
              }
              if (state.binding) state.binding.status = "active";
              return {
                data: envelope({ bindingId: args.binding_id, status: "active", changed: true }),
                error: null,
              };
            }
            case "terminate_pending_binding": {
              if (options.terminatePayload !== undefined) {
                return { data: envelope(options.terminatePayload), error: null };
              }
              if (state.binding?.status === "notice_pending") {
                state.binding.status = args.disposition === "revoked"
                  ? "revoked"
                  : "suspended";
                state.binding.disposition = String(args.disposition ?? "");
                state.binding.reason = String(args.reason ?? "");
                return {
                  data: envelope({
                    bindingId: args.binding_id,
                    status: state.binding.status,
                    terminated: true,
                  }),
                  error: null,
                };
              }
              return {
                data: envelope({
                  bindingId: args.binding_id,
                  status: state.binding?.status ?? "revoked",
                  terminated: false,
                }),
                error: null,
              };
            }
            case "ingest_channel_update": {
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
  identityFailure: null | { code: number };
  identityMalformed: boolean;
  membershipFailure: null | { code: number };
  sendFailure: null | { code: number };
  initiatorStatus: string;
  botStatus: string;
  sentMessages: number;
}

function botScript(overrides: Partial<BotScript> = {}): BotScript {
  return {
    identityFailure: null,
    identityMalformed: false,
    membershipFailure: null,
    sendFailure: null,
    initiatorStatus: "creator",
    botStatus: "administrator",
    sentMessages: 0,
    ...overrides,
  };
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
      if (script.identityFailure) {
        return respond({ ok: false, error_code: script.identityFailure.code });
      }
      // Ответ принят, но идентификатора в нём нет: контракт Telegram изменился
      // или отвечает не Telegram.
      if (script.identityMalformed) return respond({ ok: true, result: { name: "bot" } });
      return respond({ ok: true, result: { id: BOT_USER_ID } });
    }
    if (url.endsWith("/getChatMember")) {
      if (script.membershipFailure) {
        return respond({ ok: false, error_code: script.membershipFailure.code });
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as { user_id?: number };
      const status = body.user_id === BOT_USER_ID
        ? script.botStatus
        : script.initiatorStatus;
      return respond({ ok: true, result: { status } });
    }
    if (url.endsWith("/sendMessage")) {
      if (script.sendFailure) {
        return respond({
          ok: false,
          error_code: script.sendFailure.code,
          parameters: { retry_after: 5 },
        });
      }
      script.sentMessages += 1;
      return respond({ ok: true, result: { message_id: 55 } });
    }
    throw new Error(`unexpected telegram call: ${url}`);
  });
}

function groupUpdate(updateId: number, text: string): unknown {
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

const handshakeUpdate = (updateId: number, payload: string): unknown =>
  groupUpdate(updateId, `/start ${payload}`);

function webhookRequest(update: unknown): Request {
  return new Request("https://remhaos.test/api/integrations/telegram/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": WEBHOOK_SECRET,
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

function silenceLog(): { restore: () => void } {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  return { restore: () => { info.mockRestore(); error.mockRestore(); } };
}

const countOf = (bridge: ReturnType<typeof createFakeBridge>, op: string): number =>
  bridge.calls.filter((call) => call.operation === op).length;

describe("Telegram bridge — real port and real Bot API client", () => {
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

  // ── Порт: нарушение контракта не превращается в решение ───────────────────

  it("refuses a malformed pending lookup instead of calling the chat free", async () => {
    // `null` здесь значило бы «чат свободен», и маршрут пошёл бы заводить
    // вторую связь поверх существующей.
    const bridge = createFakeBridge({ lookupPayload: { pending: "maybe" } });
    installTelegramFetch(botScript());
    const route = await loadRoute(bridge);
    const log = silenceLog();

    const response = await route.POST(webhookRequest(groupUpdate(1, "форма")));
    log.restore();

    expect(response.status).toBe(503);
    expect(countOf(bridge, "activate_project_binding")).toBe(0);
  });

  it("refuses a malformed finalization instead of reporting no change", async () => {
    // `changed: false` означало бы «связь уже активна», и приём открылся бы
    // там, где база его не открывала.
    const bridge = createFakeBridge({ finalizePayload: { changed: "yes" } });
    bridge.state.binding = { status: "notice_pending" };
    installTelegramFetch(botScript());
    const route = await loadRoute(bridge);
    const log = silenceLog();

    const response = await route.POST(webhookRequest(groupUpdate(2, "форма-2")));
    log.restore();

    expect(response.status).toBe(503);
    expect(bridge.state.binding.status).toBe("notice_pending");
  });

  it("refuses a malformed termination instead of treating it as done", async () => {
    const bridge = createFakeBridge({ terminatePayload: { ok: true } });
    bridge.state.binding = { status: "notice_pending" };
    installTelegramFetch(botScript({ botStatus: "member" }));
    const route = await loadRoute(bridge);
    const log = silenceLog();

    const response = await route.POST(webhookRequest(groupUpdate(3, "форма-3")));
    log.restore();

    // Терминализация не подтверждена — связь ещё жива, и это наш сбой.
    expect(response.status).toBe(503);
    expect(bridge.state.binding.status).toBe("notice_pending");
  });

  it("does not treat `terminated: false` as a completed termination", async () => {
    const bridge = createFakeBridge({
      terminatePayload: { bindingId: LOOKUP_BINDING, status: "active", terminated: false },
    });
    bridge.state.binding = { status: "notice_pending" };
    installTelegramFetch(botScript({ botStatus: "member" }));
    const route = await loadRoute(bridge);
    const log = silenceLog();

    const response = await route.POST(webhookRequest(groupUpdate(4, "не закрыто")));
    log.restore();

    // База сказала «закрывать было нечего» — значит связь в другом состоянии,
    // и наш вывод о ней устарел. Отвечать «разобрались» нельзя.
    expect(response.status).toBe(503);
    expect(bridge.state.binding.status).toBe("notice_pending");
  });

  // ── Bot API: классификация отказов ────────────────────────────────────────

  it("treats 401 as permanent and never asks Telegram to come back", async () => {
    const bridge = createFakeBridge();
    installTelegramFetch(botScript({ identityFailure: { code: 401 } }));
    const route = await loadRoute(bridge);
    const log = silenceLog();

    const response = await route.POST(webhookRequest(handshakeUpdate(5, nonce("a"))));
    log.restore();

    expect(response.status).toBe(200);
    // Осиротевшей связи не остаётся: активация не вызывалась вовсе.
    expect(countOf(bridge, "activate_project_binding")).toBe(0);
    expect(bridge.state.binding).toBeNull();
  });

  it("treats 5xx as transient and asks Telegram to come back", async () => {
    const bridge = createFakeBridge();
    installTelegramFetch(botScript({ identityFailure: { code: 502 } }));
    const route = await loadRoute(bridge);
    const log = silenceLog();

    const response = await route.POST(webhookRequest(handshakeUpdate(6, nonce("b"))));
    log.restore();

    expect(response.status).toBe(503);
    expect(countOf(bridge, "activate_project_binding")).toBe(0);
  });

  it("treats a malformed Telegram response as transient", async () => {
    const bridge = createFakeBridge();
    installTelegramFetch(botScript({ identityMalformed: true }));
    const route = await loadRoute(bridge);
    const log = silenceLog();

    const response = await route.POST(webhookRequest(handshakeUpdate(7, nonce("c"))));
    log.restore();

    expect(response.status).toBe(503);
    expect(countOf(bridge, "activate_project_binding")).toBe(0);
  });

  it("terminates the exact pending binding when the token is permanently refused", async () => {
    const bridge = createFakeBridge();
    bridge.state.binding = { status: "notice_pending" };
    installTelegramFetch(botScript({ identityFailure: { code: 401 } }));
    const route = await loadRoute(bridge);
    const log = silenceLog();

    const response = await route.POST(webhookRequest(groupUpdate(8, "токен умер")));
    log.restore();

    expect(response.status).toBe(200);
    expect(bridge.state.binding.status).toBe("suspended");
    expect(bridge.state.binding.reason).toBe("bot_identity_refused");
    const terminate = bridge.calls.find((c) => c.operation === "terminate_pending_binding");
    expect(terminate?.args.binding_id).toBe(LOOKUP_BINDING);
  });

  // ── Точный идентификатор и повтор рукопожатия ─────────────────────────────

  it("finalizes the id activation returned, not the one a lookup would find", async () => {
    const bridge = createFakeBridge();
    installTelegramFetch(botScript());
    const route = await loadRoute(bridge);
    const log = silenceLog();

    const response = await route.POST(webhookRequest(handshakeUpdate(9, nonce("d"))));
    log.restore();

    expect(response.status).toBe(200);
    const finalize = bridge.calls.find((c) => c.operation === "mark_channel_notice_posted");
    expect(finalize?.args.binding_id).toBe(ACTIVATED_BINDING);
    expect(finalize?.args.binding_id).not.toBe(LOOKUP_BINDING);
    expect(finalize?.args.initiator_is_chat_admin).toBe(true);
    expect(finalize?.args.bot_is_chat_admin).toBe(true);
  });

  it("uses the looked-up id when it recovers an existing pending binding", async () => {
    const bridge = createFakeBridge();
    bridge.state.binding = { status: "notice_pending" };
    installTelegramFetch(botScript());
    const route = await loadRoute(bridge);
    const log = silenceLog();

    await route.POST(webhookRequest(groupUpdate(10, "чиним")));
    log.restore();

    const finalize = bridge.calls.find((c) => c.operation === "mark_channel_notice_posted");
    expect(finalize?.args.binding_id).toBe(LOOKUP_BINDING);
    expect(finalize?.args.binding_id).not.toBe(ACTIVATED_BINDING);
  });

  it("recovers on a repeated /start without spending the nonce again", async () => {
    const bridge = createFakeBridge();
    const script = botScript({ sendFailure: { code: 429 } });
    installTelegramFetch(script);
    const route = await loadRoute(bridge);
    const log = silenceLog();

    const first = await route.POST(webhookRequest(handshakeUpdate(11, nonce("e"))));
    expect(first.status).toBe(503);
    expect(bridge.state.binding?.status).toBe("notice_pending");
    expect(countOf(bridge, "activate_project_binding")).toBe(1);

    bridge.calls.length = 0;
    script.sendFailure = null;
    const repeat = await route.POST(webhookRequest(handshakeUpdate(11, nonce("e"))));
    log.restore();

    expect(repeat.status).toBe(200);
    expect(bridge.state.binding?.status).toBe("active");
    // Секрет не тратится второй раз, и второй связи не появляется.
    expect(countOf(bridge, "activate_project_binding")).toBe(0);
    expect(bridge.state.storedEvents).toBe(0);
  });

  // ── Отказы активации: смысл против сбоя ───────────────────────────────────

  for (const code of ["P1103", "P1109", "P1111"]) {
    it(`answers 200 and leaves nothing pending when activation refuses with ${code}`, async () => {
      const bridge = createFakeBridge({ activateFailure: code });
      installTelegramFetch(botScript());
      const route = await loadRoute(bridge);
      const log = silenceLog();

      const response = await route.POST(webhookRequest(handshakeUpdate(12, nonce("f"))));
      log.restore();

      expect(response.status).toBe(200);
      expect(bridge.state.binding).toBeNull();
      expect(countOf(bridge, "mark_channel_notice_posted")).toBe(0);
    });
  }

  it("answers 503 when activation fails for any other reason", async () => {
    const bridge = createFakeBridge({ activateFailure: "08006" });
    installTelegramFetch(botScript());
    const route = await loadRoute(bridge);
    const log = silenceLog();

    const response = await route.POST(webhookRequest(handshakeUpdate(13, nonce("g"))));
    log.restore();

    expect(response.status).toBe(503);
    expect(bridge.state.binding).toBeNull();
  });

  for (const code of ["P1103", "P1109", "P1111"]) {
    it(`terminates the pending binding when finalization refuses with ${code}`, async () => {
      const bridge = createFakeBridge({ finalizeFailure: code });
      bridge.state.binding = { status: "notice_pending" };
      installTelegramFetch(botScript());
      const route = await loadRoute(bridge);
      const log = silenceLog();

      const response = await route.POST(webhookRequest(groupUpdate(14, "финал")));
      log.restore();

      expect(response.status).toBe(200);
      expect(bridge.state.binding.status).toBe("revoked");
      expect(bridge.state.binding.reason).toBe("finalization_refused");
    });
  }

  it("refuses the chat when a pending binding of another bot instance holds it", async () => {
    const bridge = createFakeBridge({
      lookupPayload: { pending: false, chatHeldByOtherBot: true },
    });
    installTelegramFetch(botScript());
    const route = await loadRoute(bridge);
    const log = silenceLog();

    const response = await route.POST(webhookRequest(handshakeUpdate(15, nonce("h"))));
    log.restore();

    expect(response.status).toBe(200);
    // Ни доделывать чужое, ни заводить своё поверх.
    expect(countOf(bridge, "activate_project_binding")).toBe(0);
    expect(countOf(bridge, "mark_channel_notice_posted")).toBe(0);
  });
});
