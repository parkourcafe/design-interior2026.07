// Базовый URL приложения для построения публичных ссылок (intake / КП).
export function appUrl(): string {
  const fallback = process.env.NODE_ENV === "production"
    ? "https://www.remhaos.com"
    : "http://localhost:3000";
  const url = process.env.NEXT_PUBLIC_APP_URL ?? fallback;
  return url.replace(/\/$/, "");
}

// Контакт поддержки для случаев, когда персональный дизайнер неизвестен
// (клиентский самостоятельный бриф, Вход Б). Показывается рядом с согласием
// на обработку ПДн. Владелец должен убедиться, что этот адрес реально
// принимает почту (тот же домен, что и SMTP-отправитель).
export function supportEmail(): string {
  return process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "saidalarust@gmail.com";
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
    name: process.env.NEXT_PUBLIC_LEGAL_OPERATOR_NAME?.trim() || "Saida Nigmatullaeva",
    address: process.env.NEXT_PUBLIC_LEGAL_OPERATOR_ADDRESS?.trim() || "Индонезия, Бали, Убуд",
    email: process.env.NEXT_PUBLIC_LEGAL_OPERATOR_EMAIL?.trim() || supportEmail(),
    phone: process.env.NEXT_PUBLIC_LEGAL_OPERATOR_PHONE?.trim() || "+6281943286395",
  };
}
