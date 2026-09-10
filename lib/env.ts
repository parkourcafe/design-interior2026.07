// Базовый URL приложения для построения публичных ссылок (intake / КП).
export function appUrl(): string {
  const fallback = process.env.NODE_ENV === "production"
    ? "https://www.remhaos.com"
    : "http://localhost:3000";
  const url = process.env.NEXT_PUBLIC_APP_URL ?? fallback;
  return url.replace(/\/$/, "");
}

function publicEnvValue(
  name: string,
  fallback: string | (() => string),
): string {
  const value = process.env[name]?.trim();
  if (value) return value;

  if (process.env.NODE_ENV === "production") {
    console.warn(`[env] ${name} is not configured; using a neutral placeholder.`);
  }
  return typeof fallback === "function" ? fallback() : fallback;
}

// Контакт поддержки для случаев, когда персональный дизайнер неизвестен
// (клиентский самостоятельный бриф, Вход Б). Показывается рядом с согласием
// на обработку ПДн. В production адрес должен быть задан окружением деплоя.
export function supportEmail(): string {
  return publicEnvValue("NEXT_PUBLIC_SUPPORT_EMAIL", "support@example.invalid");
}

export interface LegalOperator {
  name: string;
  address: string;
  email: string;
  phone: string;
}

// Публичные реквизиты оператора показываются в политике и условиях. Значения
// задаются окружением деплоя: персональные данные владельца не зашиваются в
// исходный код и могут быть обновлены без изменения юридического текста.
export function legalOperator(): LegalOperator {
  return {
    name: publicEnvValue("NEXT_PUBLIC_LEGAL_OPERATOR_NAME", "Оператор не указан"),
    address: publicEnvValue("NEXT_PUBLIC_LEGAL_OPERATOR_ADDRESS", "Адрес не указан"),
    email: publicEnvValue("NEXT_PUBLIC_LEGAL_OPERATOR_EMAIL", supportEmail),
    phone: publicEnvValue("NEXT_PUBLIC_LEGAL_OPERATOR_PHONE", "Телефон не указан"),
  };
}
