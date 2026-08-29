// AP1: пять ролевых пользователей для authenticated pilot.
// Запуск: npm run provision:ap1   (нужны env DISPOSABLE-окружения, не прода)
//
// Идемпотентно: существующие пользователи переиспользуются и не дублируются.
// По явному disposable-флагу harness может синхронизировать их пароль с новым
// masked per-run credential, чтобы повторная hosted-проверка оставалась
// воспроизводимой без долгоживущего пятого секрета.
//
// Создаёт ТОЛЬКО auth-пользователей и печатает их user_id. Членства
// (projectceo_foundation.project_memberships) намеренно НЕ создаются здесь:
// по инварианту AGENTS.md «human operations не выполняются через service role»
// — доступ выдаётся через штатный invitation/grant-поток от лица owner.
// Этот скрипт закрывает ровно ту часть AP1, которую можно автоматизировать
// безопасно: наличие пяти отдельных identity с проверенным email.

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

/**
 * Пять ролей из MASTER_EXECUTION_PLAN §4 (AP1).
 * `role` — целевая роль в projectceo_foundation (project_memberships.role),
 * проставляется НЕ здесь, а через invitation-поток; хранится для справки,
 * чтобы owner знал, кого куда приглашать.
 */
const AP1_USERS = [
  { key: "owner", role: "owner_lead", note: "владелец организации, приглашает остальных" },
  { key: "designer", role: "architect", note: "дизайнер/архитектор" },
  { key: "builder", role: "builder", note: "прораб/исполнитель" },
  { key: "client", role: "client_approver", note: "заказчик" },
  { key: "guest", role: null, note: "гость — только через guest grant, без членства" },
] as const;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.includes("placeholder") || value.includes("your-")) {
    throw new Error(`Заполните ${name} в .env.local реальным значением disposable-окружения.`);
  }
  return value;
}

/** owner@ap1.<domain>, designer@ap1.<domain>, … */
function emailFor(key: string, domain: string): string {
  return `${key}@ap1.${domain}`;
}

async function main() {
  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  // Защита от случайного запуска против прода: требуем явного подтверждения,
  // что это disposable-окружение (AGENTS.md: pilot gate закрывается НЕ в проде).
  if (process.env.AP1_CONFIRM_DISPOSABLE !== "yes") {
    throw new Error(
      "Откажусь запускаться без AP1_CONFIRM_DISPOSABLE=yes.\n"
      + `Проверьте, что ${url} — это disposable-проект, а НЕ production, и повторите:\n`
      + "  AP1_CONFIRM_DISPOSABLE=yes npm run provision:ap1",
    );
  }

  const domain = process.env.AP1_EMAIL_DOMAIN ?? "remhaos.test";
  const password = requiredEnv("AP1_TEST_PASSWORD");
  const rotateExistingPassword = process.env.AP1_ROTATE_EXISTING_PASSWORD === "yes";
  if (password.length < 12) {
    throw new Error("AP1_TEST_PASSWORD должен быть не короче 12 символов.");
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Существующие пользователи — чтобы повторный запуск был идемпотентным.
  const existing = new Map<string, string>();
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    for (const user of data.users) {
      if (user.email) existing.set(user.email.toLowerCase(), user.id);
    }
    if (data.users.length < 200) break;
  }

  const results: {
    key: string;
    role: string | null;
    email: string;
    userId: string;
    created: boolean;
    rotated: boolean;
  }[] = [];
  for (const user of AP1_USERS) {
    const email = emailFor(user.key, domain);
    const already = existing.get(email.toLowerCase());
    if (already) {
      if (rotateExistingPassword) {
        const { error } = await admin.auth.admin.updateUserById(already, { password });
        if (error) throw error;
      }
      results.push({
        key: user.key,
        role: user.role,
        email,
        userId: already,
        created: false,
        rotated: rotateExistingPassword,
      });
      continue;
    }
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      // Подтверждённый email — обязателен: identity_unverified иначе закроет
      // request-bound доступ (см. command-service).
      email_confirm: true,
      user_metadata: { ap1_role: user.role, ap1_note: user.note },
    });
    if (error) throw error;
    if (!data.user) throw new Error(`Supabase не вернул пользователя для ${email}`);
    results.push({
      key: user.key,
      role: user.role,
      email,
      userId: data.user.id,
      created: true,
      rotated: false,
    });
  }

  console.log("\nAP1 role users:\n");
  for (const row of results) {
    const state = row.created ? "создан" : row.rotated ? "пароль обновлён" : "уже был";
    console.log(`  ${row.key.padEnd(9)} ${(row.role ?? "—").padEnd(15)} ${row.email.padEnd(28)} ${row.userId}  (${state})`);
  }
  console.log(
    "\nДальше — вручную, от лица owner через штатный поток (service role для этого не используем):\n"
    + "  1. owner создаёт Organization и Project;\n"
    + "  2. приглашает designer/builder/client (create_invitation → соответствующая роль);\n"
    + "  3. guest получает доступ отдельным guest grant, без членства.\n",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
