/**
 * Ссылки Telegram для подключения.
 *
 * A7 §1.5: бот НЕ может создать обычную группу — Bot API этого не позволяет.
 * Группу создаёт или выбирает человек и добавляет туда бота. Поэтому здесь нет
 * и не может быть функции «создать чат», а точный текст действия в интерфейсе
 * зафиксирован документом: «Создать или подключить Telegram-чат».
 *
 * ЧТО ПРОВЕРЕНО, А ЧТО НЕТ.
 *
 *   * `?start=<payload>` в личном чате — бот получает сообщение
 *     `/start <payload>`. Поведение документировано Bot API и на нём держится
 *     связывание личности.
 *   * `?startgroup=<payload>` — бот добавляется в выбранную группу. Доставит ли
 *     Telegram при этом `/start <payload>` В САМУ ГРУППУ, здесь не проверено:
 *     для этого нужен настоящий бот и настоящая группа, то есть гейт TG4.
 *
 * Из-за второго пункта транспорт не полагается на автоматику: подключение
 * принимается по сообщению `/start <payload>` из группы, откуда бы оно ни
 * пришло — от Telegram при добавлении бота или от человека, вставившего
 * команду руками. Поэтому интерфейс показывает и кнопку, и команду. Если TG4
 * подтвердит автоматическую доставку, запасной путь останется безвредным; если
 * опровергнет — подключение всё равно работает.
 */

const USERNAME_PATTERN = /^[A-Za-z0-9_]{5,32}$/;

function assertUsername(botUsername: string): string {
  if (!USERNAME_PATTERN.test(botUsername)) {
    throw new Error("Telegram bot username is not in the expected shape");
  }
  return botUsername;
}

/** Личный чат: связывание Telegram-аккаунта с человеком RemHaOS. */
export function identityLinkUrl(botUsername: string, nonce: string): string {
  return `https://t.me/${assertUsername(botUsername)}?start=${nonce}`;
}

/** Выбор группы: человек добавляет бота в свою или новую группу. */
export function groupBindingUrl(botUsername: string, nonce: string): string {
  return `https://t.me/${assertUsername(botUsername)}?startgroup=${nonce}`;
}

/** Запасной путь: та же команда, вставленная в группу руками. */
export function manualStartCommand(nonce: string): string {
  return `/start ${nonce}`;
}
