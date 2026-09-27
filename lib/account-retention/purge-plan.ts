// DEC-041 §2: план удаления данных дизайнера после 90-дневного срока — ТОЛЬКО
// dry-run. Ничего не удаляет; блокеры (срок, legal hold, платный архив) решает
// база (account_purge_blockers), объём — счётчики строк и префиксы хранилища.
// Сам план записывается в неизменяемый журнал заявки (record_account_purge_plan).
// Реальное удаление не разрешено: см. REMHAOS_ACCOUNT_RETENTION_DESIGN_2026-09-28.md.

export interface PurgePlanClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
  from(table: string): {
    select(columns: string, options?: { count: "exact"; head: true }): {
      eq(column: string, value: string): PromiseLike<{ data: unknown; count?: number | null; error: unknown }>;
      in(column: string, values: readonly string[]): PromiseLike<{ data: unknown; count?: number | null; error: unknown }>;
    };
  };
}

export interface AccountPurgePlan {
  readonly designerId: string;
  readonly caseId: string | null;
  readonly purgeAfter: string | null;
  readonly eligible: boolean;
  readonly blockers: readonly string[];
  readonly destructive: false;
  readonly scope: {
    readonly projects: number;
    readonly proposals: number;
    readonly answers: number;
    readonly riskCards: number;
    readonly projectRooms: number;
    readonly contractDocuments: number;
    readonly passportRevisions: number;
    readonly storagePrefixes: readonly string[];
  };
}

export async function planAccountPurge(client: PurgePlanClient, designerId: string): Promise<AccountPurgePlan> {
  const blockers = await client.rpc("account_purge_blockers", { p_designer_id: designerId });
  if (blockers.error || !blockers.data || typeof blockers.data !== "object") {
    throw new Error("account_purge_blockers_failed");
  }
  const state = blockers.data as { caseId?: unknown; purgeAfter?: unknown; blockers?: unknown };
  const blockerList = Array.isArray(state.blockers) ? state.blockers.map(String) : ["UNKNOWN"];

  const projects = await client.from("projects").select("id").eq("designer_id", designerId);
  if (projects.error) throw new Error("account_purge_projects_failed");
  const projectIds = (Array.isArray(projects.data) ? projects.data : [])
    .map((row) => String((row as { id: unknown }).id));

  const count = async (table: string): Promise<number> => {
    if (projectIds.length === 0) return 0;
    const result = await client.from(table).select("*", { count: "exact", head: true }).in("project_id", projectIds);
    if (result.error) throw new Error(`account_purge_count_failed:${table}`);
    return result.count ?? 0;
  };
  const [proposals, answers, riskCards, projectRooms, contractDocuments] = await Promise.all([
    count("proposals"), count("answers"), count("risk_cards"), count("project_rooms"), count("contract_documents"),
  ]);
  const revisions = await client.rpc("count_passport_revisions", { p_project_ids: projectIds });
  if (revisions.error) throw new Error("account_purge_revisions_failed");

  const plan: AccountPurgePlan = {
    designerId,
    caseId: typeof state.caseId === "string" ? state.caseId : null,
    purgeAfter: typeof state.purgeAfter === "string" ? state.purgeAfter : null,
    eligible: blockerList.length === 0,
    blockers: blockerList,
    destructive: false,
    scope: {
      projects: projectIds.length,
      proposals,
      answers,
      riskCards,
      projectRooms,
      contractDocuments,
      passportRevisions: Number(revisions.data ?? 0),
      storagePrefixes: projectIds.flatMap((id) => [`client-uploads/${id}/`, `client-uploads/designer-plans/${id}/`]),
    },
  };
  if (plan.caseId) {
    const recorded = await client.rpc("record_account_purge_plan", { p_designer_id: designerId, p_plan: plan });
    if (recorded.error) throw new Error("account_purge_plan_record_failed");
  }
  return plan;
}
