import "server-only";

import { z } from "zod";

/**
 * Клиент Bot API.
 *
 * Токен бота живёт в пути URL — так устроен Telegram, и выбора здесь нет.
 * Отсюда два обязательства этого модуля:
 *
 *   1. URL никогда не попадает ни в лог, ни в сообщение об ошибке, ни в текст
 *      исключения. Ошибка наружу отдаётся санитизированным КОДОМ;
 *   2. `description` из ответа Telegram тоже не логируется: он может содержать
 *      кусок отправленного текста.
 *
 * То же правило распространяется на `getFile`: возвращаемый им путь
 * скачивания подставляется в URL с токеном, и этот URL не хранится и не
 * логируется нигде — A7 отдельным пунктом.
 */

const RESPONSE_SCHEMA = z.object({
  ok: z.boolean(),
  result: z.unknown().optional(),
  error_code: z.number().int().optional(),
  parameters: z.object({ retry_after: z.number().int().optional() }).optional(),
});

export type TelegramCallOutcome =
  | { readonly ok: true; readonly result: unknown }
  | {
      readonly ok: false;
      /** Санитизированный код: `http_429`, `tg_403`, `network`, `timeout`. */
      readonly failureCode: string;
      /** Ретраить ли вообще, и через сколько секунд не раньше. */
      readonly retryable: boolean;
      readonly retryAfterSeconds: number;
    };

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Классификация отказов. Разделение проходит по одному вопросу: изменится ли
 * что-нибудь от повтора. `403` (бота выкинули из группы) от повтора не
 * изменится никогда, и ретраить его — это часами долбиться в закрытую дверь и
 * держать очередь занятой.
 */
function classify(errorCode: number, retryAfter: number | undefined): TelegramCallOutcome {
  if (errorCode === 429) {
    return {
      ok: false,
      failureCode: "tg_429",
      retryable: true,
      // Telegram сам называет паузу. Своя цифра здесь означала бы спорить с
      // сервером о его же лимите.
      retryAfterSeconds: Math.min(Math.max(retryAfter ?? 30, 1), 3600),
    };
  }
  if (errorCode === 403 || errorCode === 400) {
    return { ok: false, failureCode: `tg_${errorCode}`, retryable: false, retryAfterSeconds: 0 };
  }
  return { ok: false, failureCode: `tg_${errorCode}`, retryable: true, retryAfterSeconds: 60 };
}

export class TelegramBotApi {
  constructor(
    private readonly botToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  private async call(
    method: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<TelegramCallOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(
        `https://api.telegram.org/bot${this.botToken}/${method}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );
      const parsed = RESPONSE_SCHEMA.safeParse(await response.json());
      if (!parsed.success) {
        return {
          ok: false,
          failureCode: "response_malformed",
          retryable: true,
          retryAfterSeconds: 60,
        };
      }
      if (parsed.data.ok) return { ok: true, result: parsed.data.result };
      return classify(
        parsed.data.error_code ?? response.status,
        parsed.data.parameters?.retry_after,
      );
    } catch (error) {
      // Ни `error.message`, ни URL: сообщение узла может содержать адрес с
      // токеном. Наружу — только вид отказа.
      const aborted = error instanceof Error && error.name === "AbortError";
      return {
        ok: false,
        failureCode: aborted ? "timeout" : "network",
        retryable: true,
        retryAfterSeconds: 60,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async sendMessage(input: {
    readonly chatId: number;
    readonly text: string;
  }): Promise<TelegramCallOutcome> {
    return this.call("sendMessage", {
      chat_id: input.chatId,
      text: input.text,
      // Разметка выключена намеренно: текст собирается из значений проекта, и
      // включённый parse_mode превращает любой символ разметки в инъекцию.
      disable_web_page_preview: true,
    });
  }

  /**
   * Кто человек в этой группе. Транспорт спрашивает это до активации связи:
   * подключить чужой рабочий чат к своему проекту не должен уметь случайный
   * участник. База о правах в Telegram знать не может — это работа транспорта.
   */
  async getChatMember(input: {
    readonly chatId: number;
    readonly userId: number;
  }): Promise<TelegramCallOutcome> {
    return this.call("getChatMember", {
      chat_id: input.chatId,
      user_id: input.userId,
    });
  }
}

const CHAT_MEMBER_SCHEMA = z.object({ status: z.string() });

/** Только владелец и администратор группы. Обычный участник — нет. */
export function isChatAdministrator(result: unknown): boolean {
  const parsed = CHAT_MEMBER_SCHEMA.safeParse(result);
  if (!parsed.success) return false;
  return parsed.data.status === "creator" || parsed.data.status === "administrator";
}

export function extractSentMessageId(result: unknown): number | null {
  const parsed = z.object({ message_id: z.number().int() }).safeParse(result);
  return parsed.success ? parsed.data.message_id : null;
}
