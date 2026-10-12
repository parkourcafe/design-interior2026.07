import type { DataCellId } from "@/lib/market/contract";
import { regionalSupabaseConfig } from "./cells";

// ТЗ 08.10, FIX-04: кнопка «Войти через Google» соответствует настройке
// провайдера в Auth выбранного контура. Источник — публичные настройки
// GoTrue (/auth/v1/settings → external.google). Любая ошибка или отсутствие
// ответа — кнопки нет: пароль и код на почту остаются (закрыто по умолчанию).
export async function googleSignInEnabled(
  cellCode: DataCellId,
  fetchImpl: typeof fetch = fetch,
  source?: NodeJS.ProcessEnv,
): Promise<boolean> {
  try {
    const config = source ? regionalSupabaseConfig(cellCode, source) : regionalSupabaseConfig(cellCode);
    const response = await fetchImpl(`${config.url.replace(/\/+$/, "")}/auth/v1/settings`, {
      headers: { apikey: config.publishableKey },
      cache: "no-store",
    });
    if (!response.ok) return false;
    const settings = (await response.json()) as { external?: { google?: unknown } };
    return settings.external?.google === true;
  } catch {
    return false;
  }
}
