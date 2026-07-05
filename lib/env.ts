// Базовый URL приложения для построения публичных ссылок (intake / КП).
export function appUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return url.replace(/\/$/, "");
}

// Контакт поддержки для случаев, когда персональный дизайнер неизвестен
// (клиентский самостоятельный бриф, Вход Б). Показывается рядом с согласием
// на обработку ПДн. Владелец должен убедиться, что этот адрес реально
// принимает почту (тот же домен, что и SMTP-отправитель).
export function supportEmail(): string {
  return process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@arhidom.space";
}
