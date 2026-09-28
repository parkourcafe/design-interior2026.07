// GigaChat (Сбер) — задокументированный запасной провайдер. Заглушка v0.1:
// интерфейс совпадает с YandexGPT (prompt → текст), так что переключение через
// LLM_PROVIDER=gigachat не потребует изменений в продуктовом коде.
//
// Полная реализация (в отдельной фазе) требует OAuth-обмена GIGACHAT_AUTH_KEY на
// access_token (POST https://ngw.devices.sberbank.ru:9443/api/v2/oauth) и вызова
// POST https://gigachat.devices.sberbank.ru/api/v1/chat/completions с российским
// корневым сертификатом НУЦ Минцифры. Здесь не поднимаем, чтобы не тащить mTLS-
// конфигурацию в скелет; YandexGPT — основной путь.

export async function completeGigaChat(_prompt: string): Promise<string> {
  throw new Error(
    "gigachat_not_implemented: запасной провайдер не подключён в v0.1. " +
      "Используйте LLM_PROVIDER=yandex. Реализация GigaChat — отдельная фаза (см. BACKLOG).",
  );
}
