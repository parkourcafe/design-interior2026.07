import Link from "next/link";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { ru } from "@/lib/i18n/ru";
import { isLayoutStudioEnabled } from "@/lib/layout-studio/feature-flag";
import CreateLayoutForm from "./create-layout-form";

export const dynamic = "force-dynamic";

const copy = ru.layoutStudio.project;

interface LayoutRow {
  document_id: string;
  title: string;
  updated_at: string;
  draft: { stateRevision?: number } | null;
}

/**
 * Планировки проекта (модуль 2 — работа по утверждённому КП).
 *
 * Проект и планировки читаются обычным клиентом от имени залогиненного
 * дизайнера: чужой проект отсекается политиками RLS и превращается в 404 —
 * так страница не подтверждает даже факт его существования.
 */
export default async function ProjectLayoutsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isLayoutStudioEnabled()) notFound();
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, client_name")
    .eq("id", id)
    .maybeSingle();
  if (!project) notFound();

  const { data } = await supabase
    .from("layout_documents")
    .select("document_id, title, updated_at, draft")
    .eq("project_id", id)
    .order("updated_at", { ascending: false });
  const layouts = (data as LayoutRow[] | null) ?? [];

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href={`/dashboard/projects/${id}`} className="text-sm underline">
        ← {copy.back}
      </Link>

      <h1 className="mt-4 text-2xl font-semibold">{copy.title}</h1>
      <p className="mt-1 text-sm text-neutral-600">{copy.subtitle}</p>

      {layouts.length === 0 ? (
        <p className="mt-8 rounded border border-neutral-200 p-6 text-sm text-neutral-600">
          {copy.empty}
        </p>
      ) : (
        <ul className="mt-6 space-y-2">
          {layouts.map((layout) => (
            <li
              key={layout.document_id}
              className="flex items-center justify-between rounded border border-neutral-200 p-4"
            >
              <span>
                <span className="block font-medium">{layout.title || copy.untitled}</span>
                <span className="block text-xs text-neutral-500">
                  {copy.revision} {layout.draft?.stateRevision ?? 0} · {copy.updatedAt}{" "}
                  {new Date(layout.updated_at).toLocaleString("ru-RU")}
                </span>
              </span>
              <Link
                href={`/dashboard/projects/${id}/layouts/${encodeURIComponent(layout.document_id)}`}
                className="text-sm underline"
              >
                {copy.open}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <CreateLayoutForm projectId={id} />
    </main>
  );
}
