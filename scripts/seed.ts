// Seed: демо-дизайнер с заполненными pricing и proposal_defaults.
// Запуск: npm run seed   (нужны реальные Supabase env в .env.local)
//
// Идемпотентно: если пользователь с demo-email уже есть — обновляет его строку.

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { PricingConfig, ProposalDefaults } from "../lib/types";

config({ path: ".env.local" });

const DEMO_EMAIL = "demo@studio.ru";

const pricing: PricingConfig = {
  base_rate_per_m2: 3500, // ₽/м²
  multipliers: {
    complexity: { low: 0.85, mid: 1.0, high: 1.4 },
    urgency: 1.3,
    package: { concept: 0.6, full: 1.0, full_plus_supervision: 1.35 },
  },
};

const proposalDefaults: ProposalDefaults = {
  exclusions: [
    "Строительно-монтажные работы",
    "Закупка мебели и материалов (комплектация — отдельно)",
    "Авторский надзор, если не выбран отдельно",
  ],
  revision_limit: 2,
  stage_completion:
    "Этап считается завершённым после письменного согласования клиентом материалов этапа.",
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey || url.includes("placeholder")) {
    throw new Error(
      "Заполните NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env.local реальными значениями.",
    );
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Найти или создать auth-пользователя.
  const { data: list } = await admin.auth.admin.listUsers();
  let userId = list?.users.find((u) => u.email === DEMO_EMAIL)?.id;

  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email: DEMO_EMAIL,
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;
    console.log(`Создан demo-пользователь ${DEMO_EMAIL} (${userId})`);
  } else {
    console.log(`Demo-пользователь уже существует (${userId})`);
  }

  // 2. Upsert строки дизайнера с pricing и proposal_defaults.
  const { error: upsertError } = await admin.from("designers").upsert({
    id: userId,
    name: "Демо Дизайнер",
    studio_name: "Студия Демо",
    pricing,
    proposal_defaults: proposalDefaults,
  });
  if (upsertError) throw upsertError;

  console.log("Готово: демо-дизайнер с pricing и proposal_defaults засеян.");
  console.log(`Войдите magic-link'ом на ${DEMO_EMAIL}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
