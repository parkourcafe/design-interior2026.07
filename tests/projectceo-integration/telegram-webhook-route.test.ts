import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Настоящая граница HTTP вебхука.
 *
 * Проверяется не «функция вернула объект», а маршрут: `Request` входит, `Response`
 * выходит, и коды ответа значат ровно то, что значат для Telegram. Разница
 * существенная — половина проверок ниже (заголовок секрета, content-type, размер
 * тела, метод) живёт ТОЛЬКО в маршруте, и вызовом сервиса их не увидеть.
 *
 * Внешних вызовов здесь нет: Supabase-клиент подменён, `fetch` не используется.
 * Всё, что доказывается, — поведение самой границы.
 */

const SECRET = "s".repeat(48);
const SECRET_HEADER = "x-telegram-bot-api-secret-token";

const rpc = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ schema: () => ({ rpc }) }),
}));

function envelope(data: unknown) {
  return {
    data: {
      contractVersion: "remhaos-telegram-bridge/0.1",
      requestId: "db:test",
      data,
      error: null,
    },
    error: null,
  };
}

function request(body: unknown, init: {
  readonly secret?: string | null;
  readonly contentType?: string | null;
} = {}): Request {
  const headers = new Headers();
  if (init.contentType !== null) headers.set("content-type", init.contentType ?? "application/json");
  if (init.secret !== null) headers.set(SECRET_HEADER, init.secret ?? SECRET);
  return new Request("https://remhaos.test/api/integrations/telegram/webhook", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const groupMessage = {
  update_id: 900,
  message: {
    message_id: 11,
    date: 1_800_000_000,
    chat: { id: -1001000000001, type: "supergroup" },
    from: { id: 770001 },
    text: "Нужно заменить плитку в санузле",
  },
};

async function loadRoute() {
  // Маршрут читает окружение на модульном уровне через `resolveTelegramBridgeConfig`,
  // поэтому импорт делается ПОСЛЕ настройки env в каждом тесте.
  return import("@/app/api/integrations/telegram/webhook/route");
}

describe("telegram webhook route", () => {
  const original = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    rpc.mockReset();
    process.env.REMHAOS_TELEGRAM_BRIDGE_ENABLED = "true";
    process.env.TELEGRAM_TEST_BOT_TOKEN = "123456:test-token";
    process.env.TELEGRAM_TEST_BOT_USERNAME = "RemHaOSTestBot";
    process.env.TELEGRAM_TEST_WEBHOOK_SECRET = SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  });

  afterEach(() => {
    process.env = { ...original };
  });

  /**
   * Выключенный мост не принимает НИЧЕГО и не сообщает о своём существовании:
   * 404, и ни одного обращения к базе. Проверка стоит до всего остального
   * намеренно (A7 §7).
   */
  it("answers 404 and touches nothing when the bridge is disabled", async () => {
    process.env.REMHAOS_TELEGRAM_BRIDGE_ENABLED = "false";
    const { POST } = await loadRoute();
    const response = await POST(request(groupMessage));
    expect(response.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers 404 when the bridge is on but its secrets are missing", async () => {
    delete process.env.TELEGRAM_TEST_WEBHOOK_SECRET;
    const { POST } = await loadRoute();
    expect((await POST(request(groupMessage))).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  /** Отсутствующий и поддельный секрет — один и тот же отказ, и без записи. */
  it("rejects a missing or forged secret without writing anything", async () => {
    const { POST } = await loadRoute();
    expect((await POST(request(groupMessage, { secret: null }))).status).toBe(401);
    expect((await POST(request(groupMessage, { secret: "x".repeat(48) }))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a body that is not JSON and one that is too large", async () => {
    const { POST } = await loadRoute();
    expect((await POST(request(groupMessage, { contentType: "text/plain" }))).status).toBe(415);
    const huge = JSON.stringify({ update_id: 1, message: { text: "x".repeat(100_000) } });
    expect((await POST(request(huge))).status).toBe(413);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a body that is not parseable at all", async () => {
    const { POST } = await loadRoute();
    expect((await POST(request("{not json"))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  /**
   * Подлинный, но неподдерживаемый update получает 2xx: ответить ошибкой —
   * значит обречь Telegram повторять его вечно.
   */
  it("answers 2xx to an authentic update it does not support", async () => {
    const { POST } = await loadRoute();
    const response = await POST(request({ update_id: 12, poll_answer: { poll_id: "1" } }));
    expect(response.status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers 400 to a body that is not a Telegram update at all", async () => {
    const { POST } = await loadRoute();
    expect((await POST(request({ hello: "world" }))).status).toBe(400);
  });

  it("records an authentic message and answers 200", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "resolve_channel_binding") {
        return Promise.resolve(envelope({
          bindingId: "11111111-1111-4111-8111-111111111111",
          organizationId: "22222222-2222-4222-8222-222222222222",
          projectId: "33333333-3333-4333-8333-333333333333",
          status: "active",
          captureMode: "full_after_notice",
        }));
      }
      if (name === "record_channel_event") {
        return Promise.resolve(envelope({
          eventId: "44444444-4444-4444-8444-444444444444",
          duplicate: false,
          projectId: "33333333-3333-4333-8333-333333333333",
        }));
      }
      throw new Error(`unexpected rpc ${name}`);
    });

    const { POST } = await loadRoute();
    const response = await POST(request(groupMessage));
    expect(response.status).toBe(200);
    expect(rpc.mock.calls.map((call) => call[0])).toEqual([
      "resolve_channel_binding",
      "record_channel_event",
    ]);
  });

  /**
   * Временный сбой записи обязан вернуться non-2xx. Ответить 200 здесь значило
   * бы потерять сообщение молча: Telegram больше не повторит.
   */
  it("answers 5xx when the durable write failed transiently", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "resolve_channel_binding") {
        return Promise.resolve(envelope({
          bindingId: "11111111-1111-4111-8111-111111111111",
          organizationId: "22222222-2222-4222-8222-222222222222",
          projectId: "33333333-3333-4333-8333-333333333333",
          status: "active",
          captureMode: "full_after_notice",
        }));
      }
      return Promise.resolve({ data: null, error: { code: "P1112", message: "internal" } });
    });
    const { POST } = await loadRoute();
    expect((await POST(request(groupMessage))).status).toBe(503);
  });

  it("answers 5xx rather than 2xx when there is nowhere to write", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { POST } = await loadRoute();
    expect((await POST(request(groupMessage))).status).toBe(503);
  });

  /** GET существует только чтобы зонд ничего не узнал. */
  it("gives a prober the same answer as a disabled bridge", async () => {
    const { GET } = await loadRoute();
    expect((await GET()).status).toBe(404);
  });

  /**
   * Тело ответа пустое: всё, что мы могли бы туда написать, — подсказка тому,
   * кто зондирует URL.
   */
  it("never says anything in the response body", async () => {
    const { POST } = await loadRoute();
    const response = await POST(request(groupMessage, { secret: "x".repeat(48) }));
    expect(await response.text()).toBe("");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
