import { createHash, randomBytes } from "node:crypto";
import type { PostgresBytea } from "@/lib/project-intelligence/adapters/postgres";

/**
 * Одноразовый секрет ссылки подключения.
 *
 * В базу уходит ТОЛЬКО sha256 (`channel_link_intents.nonce_digest`). Сам
 * секрет живёт в ссылке, которую человек открывает, и больше нигде: ни в
 * таблице, ни в логе, ни в ответе состояния экрана. Утечка дампа базы не даёт
 * рабочей ссылки.
 *
 * Случайный, а не выведенный из ключа: `nonce_digest` уникален по
 * `(provider, nonce_digest)`, и детерминированный вывод из (проект, человек)
 * означал бы, что после отключения тот же проект уже нельзя подключить снова —
 * дайджест совпал бы с потраченным.
 *
 * Длина payload у deep link Telegram — 64 символа из `A-Za-z0-9_-`.
 * base64url от 32 байт даёт 43 символа и состоит ровно из этого алфавита.
 */

const NONCE_BYTES = 32;

export interface ChannelLinkNonce {
  /** Секрет для ссылки. Не логировать, не хранить. */
  readonly nonce: string;
  /** Дайджест для базы. */
  readonly digest: PostgresBytea;
}

function toPostgresBytea(bytes: Uint8Array): PostgresBytea {
  return `\\x${Buffer.from(bytes).toString("hex")}` as PostgresBytea;
}

export function createChannelLinkNonce(): ChannelLinkNonce {
  const bytes = randomBytes(NONCE_BYTES);
  return {
    nonce: bytes.toString("base64url"),
    digest: toPostgresBytea(createHash("sha256").update(bytes).digest()),
  };
}

/**
 * Дайджест предъявленного секрета. Возвращает null на любом непохожем вводе:
 * webhook принимает текст из интернета, и «похоже на nonce» — не то же самое,
 * что «является».
 */
export function digestChannelLinkNonce(nonce: string): PostgresBytea | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(nonce)) return null;
  const bytes = Buffer.from(nonce, "base64url");
  if (bytes.byteLength !== NONCE_BYTES) return null;
  return toPostgresBytea(createHash("sha256").update(bytes).digest());
}
