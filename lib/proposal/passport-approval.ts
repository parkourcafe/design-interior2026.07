// Состояние утверждения паспорта проекта для отправки КП (аудит 28.09, шаг 6).
//
// Отправка КП требует утверждённого запроса на паспорт текущей ревизии
// (sendProposal и триггер guard_proposal_lifecycle). Самостоятельно
// зарегистрированный дизайнер упирался в тупик: утверждение работает только
// для проекта, зачисленного в рабочее пространство, а кнопки зачисления не
// было. Здесь — только чтение состояния через request-bound клиент; сами шаги
// (зачисление, запрос, утверждение) делает дизайнер через существующие
// authenticated-маршруты /api/projectceo/enroll и /api/projectceo/commands.

export type PassportApprovalProgress =
  | { readonly state: "approved" }
  | { readonly state: "not_enrolled" }
  | {
      readonly state: "pending";
      readonly request: { readonly requestId: string; readonly status: "draft" | "submitted" } | null;
    };

type RpcClient = {
  schema(name: string): {
    rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
  };
};

type RequestRow = {
  readonly requestId?: unknown;
  readonly subjectKind?: unknown;
  readonly subjectId?: unknown;
  readonly status?: unknown;
  readonly subjectRevisionCurrent?: unknown;
  readonly requestedByCurrentActor?: unknown;
};

export async function readPassportApproval(
  client: RpcClient,
  projectId: string,
): Promise<PassportApprovalProgress> {
  const { data, error } = await client
    .schema("projectceo_platform_api")
    .rpc("list_approval_requests", { p_project_id: projectId, p_status: null });
  // Проект не зачислен — у дизайнера нет доступа к запросам этого проекта.
  if (error) return { state: "not_enrolled" };
  const requests = (data as { readonly requests?: unknown } | null)?.requests;
  const rows = (Array.isArray(requests) ? requests : []) as RequestRow[];
  const current = rows.filter((row) => (
    row.subjectKind === "project_passport"
    && row.subjectId === projectId
    && row.subjectRevisionCurrent === true
  ));
  if (current.some((row) => row.status === "approved")) return { state: "approved" };
  // Продолжить свой незавершённый запрос, а не плодить новые.
  const own = [...current].reverse().find((row) => (
    row.requestedByCurrentActor === true
    && (row.status === "draft" || row.status === "submitted")
    && typeof row.requestId === "string"
  ));
  return {
    state: "pending",
    request: own
      ? { requestId: own.requestId as string, status: own.status as "draft" | "submitted" }
      : null,
  };
}
