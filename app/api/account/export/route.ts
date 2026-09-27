import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Полный экспорт данных дизайнера (DEC-040, DEC-044 (a)). Читается под RLS
// самого дизайнера — только его проекты; версии паспорта закрыты для API и
// отдаются базой только владельцу проекта (export_passport_revisions).
// Токены доступа (ссылка на бриф, публичная ссылка КП) в экспорт не входят.
// Файлы не вкладываются: экспорт перечисляет их пути.

type Row = Record<string, unknown>;

function withoutKeys(row: Row, keys: readonly string[]): Row {
  const copy: Row = { ...row };
  for (const key of keys) delete copy[key];
  return copy;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован." }, { status: 401 });

  const failed = () => NextResponse.json({ error: "Не удалось собрать экспорт." }, { status: 500 });

  const [designer, projects] = await Promise.all([
    supabase.from("designers").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("projects").select("*").eq("designer_id", user.id),
  ]);
  if (designer.error || projects.error) return failed();
  const projectRows = (projects.data ?? []) as Row[];
  const projectIds = projectRows.map((row) => String(row.id));

  const byProject = async (table: string) => {
    if (projectIds.length === 0) return [] as Row[];
    const { data, error } = await supabase.from(table).select("*").in("project_id", projectIds);
    if (error) throw error;
    return (data ?? []) as Row[];
  };

  let answers: Row[];
  let riskCards: Row[];
  let proposals: Row[];
  let contractDocuments: Row[];
  let events: Row[];
  let passportRevisions: Row[];
  try {
    [answers, riskCards, proposals, contractDocuments, events] = await Promise.all([
      byProject("answers"),
      byProject("risk_cards"),
      byProject("proposals"),
      byProject("contract_documents"),
      byProject("events"),
    ]);
    const revisions = await supabase.rpc("export_passport_revisions");
    if (revisions.error) throw revisions.error;
    passportRevisions = Array.isArray(revisions.data) ? revisions.data as Row[] : [];
  } catch {
    return failed();
  }

  const retention = await supabase.rpc("get_account_retention_status");
  const forProject = (rows: readonly Row[], projectId: string) => rows.filter((row) => String(row.project_id) === projectId);
  const body = {
    exportVersion: "remhaos-account-export/1",
    exportedAt: new Date().toISOString(),
    designer: designer.data ?? null,
    retention: retention.error ? null : retention.data ?? null,
    projects: projectRows.map((project) => {
      const id = String(project.id);
      return {
        ...withoutKeys(project, ["intake_token"]),
        answers: forProject(answers, id),
        riskCards: forProject(riskCards, id),
        passportRevisions: forProject(passportRevisions, id),
        proposals: forProject(proposals, id).map((row) => withoutKeys(row, ["public_token"])),
        contractDocuments: forProject(contractDocuments, id),
        events: forProject(events, id),
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
}
