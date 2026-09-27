// Оператор: dry-run плана удаления данных дизайнера (DEC-041 §2). Ничего не
// удаляет. Запуск: npx tsx scripts/plan-account-purge.ts <designer-uuid>
import { createScopedServiceClient } from "@/lib/supabase/token-scoped";
import { planAccountPurge, type PurgePlanClient } from "@/lib/account-retention/purge-plan";

async function main() {
  const designerId = process.argv[2] ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(designerId)) {
    throw new Error("usage: plan-account-purge <designer-uuid>");
  }
  const client = createScopedServiceClient("operator-account-purge-plan") as unknown as PurgePlanClient;
  const plan = await planAccountPurge(client, designerId);
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
