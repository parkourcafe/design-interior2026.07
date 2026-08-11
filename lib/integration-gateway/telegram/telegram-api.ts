/**
 * Клиент Telegram Bot API. Единственное место, где мост ходит наружу.
 *
 * ПРАВИЛА, которые здесь не декоративны:
 *
 *   * URL запроса содержит токен бота. Он НЕ попадает ни в исключение, ни в лог,
 *     ни в сообщение об ошибке — наружу уходит только код. Поэтому у ошибок
 *     этого модуля нет поля с URL и нет исходного текста ответа;
 *   * `getFile` возвращает `file_path`, из которого строится download URL — и
 *     он тоже содержит токен. Метод отдаёт только относительный путь, а URL
 *     собирается на месте скачивания и нигде не сохраняется;
 *   * `429` от Telegram несёт `retry_after`. Его надо соблюдать, а не удваивать
 *     от себя: удвоение превращает вежливый лимит в собственный простой.
 */

import { sanitizeFailureCode } from "./bridge-log";

const API_ROOT = "https://api.telegram.org";

export class TelegramApiError extends Error {
  constructor(
    readonly code: string,
    /** Секунды до повтора по требованию Telegram, если он их назвал. */
    readonly retryAfterSeconds: number | null = null,
    readonly httpStatus: number | null = null,
  ) {
    // Сообщение — код, и только код: любая часть ответа Telegram может нести
    // содержимое переписки или путь к файлу.
    super(`telegram_api_${code}`);
    this.name = "TelegramApiError";
  }
}

export interface TelegramChatMember {
  readonly status: string;
  readonly userId: number;
}

export interface TelegramSendResult {
  readonly messageId: number;
}

export interface TelegramApiOptions {
  readonly botToken: string;
  /** Подменяется в тестах; в рантайме — глобальный fetch. */
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

interface TelegramEnvelope<T> {
  readonly ok: boolean;
  readonly result?: T;
  readonly error_code?: number;
  readonly description?: string;
  readonly parameters?: { readonly retry_after?: number };
}

export class TelegramApi {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: TelegramApiOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  private async call<T>(method: string, body: Readonly<Record<string, unknown>>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${API_ROOT}/bot${this.options.botToken}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      // Сетевой сбой — временный по определению: ответ мог и дойти. Наружу
      // уходит код, а не сообщение: в нём бывает URL с токеном.
      throw new TelegramApiError(
        (error as { name?: string } | null)?.name === "AbortError" ? "timeout" : "network_error",
      );
    } finally {
      clearTimeout(timer);
    }

    let envelope: TelegramEnvelope<T>;
    try {
      envelope = await response.json() as TelegramEnvelope<T>;
    } catch {
      throw new TelegramApiError("invalid_response", null, response.status);
    }

    if (!response.ok || !envelope.ok) {
      const retryAfter = typeof envelope.parameters?.retry_after === "number"
        ? envelope.parameters.retry_after
        : null;
      // 429 и 5xx — временные; 4xx — постоянные. Разделение важно ровно потому,
      // что повторять постоянную ошибку значит греть Telegram впустую.
      const code = response.status === 429
        ? "rate_limited"
        : response.status >= 500
          ? "upstream_error"
          : `request_rejected_${envelope.error_code ?? response.status}`;
      throw new TelegramApiError(
        sanitizeFailureCode(code, "request_rejected"),
        retryAfter,
        response.status,
      );
    }
    if (envelope.result === undefined) {
      throw new TelegramApiError("empty_result", null, response.status);
    }
    return envelope.result;
  }

  async sendMessage(input: {
    readonly chatId: string;
    readonly text: string;
    readonly replyMarkup?: Readonly<Record<string, unknown>>;
  }): Promise<TelegramSendResult> {
    const result = await this.call<{ message_id: number }>("sendMessage", {
      chat_id: input.chatId,
      text: input.text,
      // Разметка выключена намеренно: текст уведомления собирается из шаблона, а
      // включённый парсер превращает случайный символ в синтаксическую ошибку
      // на стороне Telegram.
      disable_web_page_preview: true,
      ...(input.replyMarkup ? { reply_markup: input.replyMarkup } : {}),
    });
    return { messageId: result.message_id };
  }

  async getChatMember(input: {
    readonly chatId: string;
    readonly userId: string;
  }): Promise<TelegramChatMember> {
    const result = await this.call<{ status: string; user: { id: number } }>("getChatMember", {
      chat_id: input.chatId,
      user_id: Number(input.userId),
    });
    return { status: result.status, userId: result.user.id };
  }

  /**
   * Администратор ли этот человек в этой группе. Именно этот вопрос задаёт
   * подключение чата: бота в группу добавляет кто угодно, а связать её с
   * проектом вправе только тот, кто в ней распоряжается.
   */
  async isChatAdministrator(input: {
    readonly chatId: string;
    readonly userId: string;
  }): Promise<boolean> {
    const member = await this.getChatMember(input);
    return member.status === "creator" || member.status === "administrator";
  }

  /**
   * Относительный путь файла. URL для скачивания здесь НЕ собирается: он
   * содержит токен бота, и вернуть его наружу значило бы отдать секрет тому, кто
   * попросил метаданные.
   */
  async getFilePath(fileId: string): Promise<string> {
    const result = await this.call<{ file_path?: string }>("getFile", { file_id: fileId });
    if (!result.file_path) throw new TelegramApiError("file_path_missing");
    return result.file_path;
  }

  /** Установка вебхука. Вызывается runbook'ом, не приложением. */
  async setWebhook(input: {
    readonly url: string;
    readonly secretToken: string;
    readonly allowedUpdates: readonly string[];
  }): Promise<boolean> {
    return this.call<boolean>("setWebhook", {
      url: input.url,
      secret_token: input.secretToken,
      allowed_updates: input.allowedUpdates,
      // Копившиеся, пока вебхука не было, обновления не нужны: история до
      // подключения не импортируется (A7 §5.3), и вываливать её на свежую
      // привязку значило бы нарушить это обещание в первую же секунду.
      drop_pending_updates: true,
    });
  }

  async deleteWebhook(): Promise<boolean> {
    return this.call<boolean>("deleteWebhook", { drop_pending_updates: false });
  }
}
