import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { ap5Env, type Ap5RoleKey } from "./ap5-env";

const env = ap5Env();

/**
 * Access token настоящей человеческой сессии.
 *
 * Выделено из `global-setup.ts`, когда тот же токен понадобился шагу цепочки:
 * два экземпляра этой процедуры разошлись бы молча, а расходиться им нельзя —
 * от способа входа зависит claim `email_verified`, без которого вся поверхность
 * ProjectCEO закрыта как `identity_unverified`.
 *
 * Вход именно по magic link, а не по паролю: `custom_access_token_hook`
 * (миграции `20260801150000`, `20260802001000`) выдаёт `email_verified` только
 * методам, доказывающим владение адресом. Service role здесь подменяет
 * ДОСТАВКУ письма, а не выполняет операцию за человека — токен принадлежит
 * человеку, и от его имени идут все вызовы.
 */
export async function accessTokenFor(role: Ap5RoleKey): Promise<string> {
  const admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: env.emailFor(role),
  });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    throw new Error(`AP5: не выпустить ссылку для ${role}: ${error?.message ?? "нет токена"}`);
  }
  const client = createClient(env.supabaseUrl, env.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const verified = await client.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  if (verified.error || !verified.data.session) {
    throw new Error(
      `AP5: ${role} не получил сессию: ${verified.error?.message ?? "нет сессии"}`,
    );
  }
  return verified.data.session.access_token;
}

/** Клиент, ходящий ТОКЕНОМ ЧЕЛОВЕКА: ни одной операции от service role. */
export function clientForToken(accessToken: string): SupabaseClient {
  return createClient(env.supabaseUrl, env.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
