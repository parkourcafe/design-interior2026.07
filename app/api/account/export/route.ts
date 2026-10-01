import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ru } from "@/lib/i18n/ru";

export const dynamic = "force-dynamic";

// Полный экспорт данных дизайнера (DEC-040, DEC-044 (a)). Читается под RLS
// самого дизайнера — только его проекты и его студия; версии паспорта закрыты
// для API и отдаются базой только владельцу проекта (export_passport_revisions).
// Токены доступа (ссылка на бриф, публичная ссылка КП, ссылки участников
// комнаты) в экспорт не входят. Файлы не вкладываются: экспорт перечисляет их
// пути (ответы брифа, договоры). Данные ProjectCEO в этот экспорт не входят.

type Row = Record<string, unknown>;
type Client = Awaited<ReturnType<typeof createClient>>;

const PAGE = 1000;
const CHUNK = 100;

function withoutKeys(row: Row, keys: readonly string[]): Row {
  const copy: Row = { ...row };
  for (const key of keys) delete copy[key];
  return copy;
}

// Постранично: в Data API действует лимит строк на ответ, молча обрезать
// экспорт нельзя.
async function readAll(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    const page = Array.isArray(data) ? data as Row[] : [];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

async function byKeys(supabase: Client, table: string, column: string, keys: readonly string[]): Promise<Row[]> {
  const rows: Row[] = [];
  for (let start = 0; start < keys.length; start += CHUNK) {
    const chunk = keys.slice(start, start + CHUNK);
    rows.push(...await readAll((from, to) => supabase.from(table).select("*").in(column, chunk).range(from, to)));
  }
  return rows;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован." }, { status: 401 });

  // DEC-047: после запроса удаления аккаунт закрыт — экспорт тоже (скачать
  // его можно до запроса).
  // Ошибка чтения статуса — отказ, а не экспорт: закрытость не должна
  // зависеть от того, ответила ли база.
  const status = await supabase.rpc("get_account_retention_status");
  if (status.error) {
    return NextResponse.json({ error: "Не удалось проверить статус аккаунта." }, { status: 503 });
  }
  const state = status.data as { status?: string; closed?: boolean } | null;
  if (state?.closed === true || state?.status === "expired") {
    return NextResponse.json({ error: "account_closed", message: ru.retention.closedExport }, { status: 403 });
  }

  try {
    const designer = await supabase.from("designers").select("*").eq("id", user.id).maybeSingle();
    if (designer.error) throw designer.error;
    const projects = await readAll((from, to) => supabase.from("projects").select("*").eq("designer_id", user.id).range(from, to));
    const projectIds = projects.map((row) => String(row.id));

    const [answers, riskCards, proposals, contractDocuments, events, rooms, layoutDocuments] = await Promise.all([
      byKeys(supabase, "answers", "project_id", projectIds),
      byKeys(supabase, "risk_cards", "project_id", projectIds),
      byKeys(supabase, "proposals", "project_id", projectIds),
      byKeys(supabase, "contract_documents", "project_id", projectIds),
      byKeys(supabase, "events", "project_id", projectIds),
      byKeys(supabase, "project_rooms", "project_id", projectIds),
      byKeys(supabase, "layout_documents", "project_id", projectIds),
    ]);
    const roomIds = rooms.map((row) => String(row.id));
    const [participants, tasks, taskEvents, layoutCheckpoints, studioMembers, designerEvents] = await Promise.all([
      byKeys(supabase, "project_participants", "room_id", roomIds),
      byKeys(supabase, "project_tasks", "room_id", roomIds),
      byKeys(supabase, "project_task_events", "room_id", roomIds),
      byKeys(supabase, "layout_checkpoints", "layout_document_id", layoutDocuments.map((row) => String(row.id))),
      readAll((from, to) => supabase.from("studio_members").select("*").eq("owner_id", user.id).range(from, to)),
      readAll((from, to) => supabase.from("events").select("*").eq("designer_id", user.id).is("project_id", null).range(from, to)),
    ]);
    const revisions = await supabase.rpc("export_passport_revisions");
    if (revisions.error) throw revisions.error;
    const passportRevisions = Array.isArray(revisions.data) ? revisions.data as Row[] : [];
    const retention = await supabase.rpc("get_account_retention_status");

    const forProject = (rows: readonly Row[], projectId: string) => rows.filter((row) => String(row.project_id) === projectId);
    const forRooms = (rows: readonly Row[], ids: ReadonlySet<string>) => rows.filter((row) => ids.has(String(row.room_id)));
    const body = {
      exportVersion: "remhaos-account-export/2",
      exportedAt: new Date().toISOString(),
      designer: designer.data ?? null,
      retention: retention.error ? null : retention.data ?? null,
      studioMembers,
      designerEvents,
      projects: projects.map((project) => {
        const id = String(project.id);
        const projectRooms = forProject(rooms, id);
        const projectRoomIds = new Set(projectRooms.map((row) => String(row.id)));
        const projectLayouts = forProject(layoutDocuments, id);
        const layoutIds = new Set(projectLayouts.map((row) => String(row.id)));
        return {
          ...withoutKeys(project, ["intake_token"]),
          answers: forProject(answers, id),
          riskCards: forProject(riskCards, id),
          passportRevisions: forProject(passportRevisions, id),
          proposals: forProject(proposals, id).map((row) => withoutKeys(row, ["public_token"])),
          contractDocuments: forProject(contractDocuments, id),
          events: forProject(events, id),
          rooms: projectRooms,
          participants: forRooms(participants, projectRoomIds).map((row) => withoutKeys(row, ["access_token"])),
          tasks: forRooms(tasks, projectRoomIds),
          taskEvents: forRooms(taskEvents, projectRoomIds),
          layoutDocuments: projectLayouts,
          layoutCheckpoints: layoutCheckpoints.filter((row) => layoutIds.has(String(row.layout_document_id))),
        };
      }),
    };

    return new NextResponse(JSON.stringify(body, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="remhaos-export-${new Date().toISOString().slice(0, 10)}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Не удалось собрать экспорт." }, { status: 500 });
  }
}
