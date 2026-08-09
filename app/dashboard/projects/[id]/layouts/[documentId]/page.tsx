import Link from "next/link";
import { notFound } from "next/navigation";

import ForkVariantForm from "./fork-variant-form";
import { LayoutStudioShell } from "@/components/layout-studio/layout-studio-shell";
import { createClient } from "@/lib/supabase/server";
import { ru } from "@/lib/i18n/ru";
import { isLayoutStudioEnabled } from "@/lib/layout-studio/feature-flag";
import type { LayoutDocument } from "@/lib/layout-studio/domain";

export const dynamic = "force-dynamic";

const copy = ru.layoutStudio.project;

/**
 * Редактор планировки внутри проекта.
 *
 * Черновик читается на сервере — редактор открывается уже с документом, без
 * пустого кадра. Дальше он сохраняет через /api/layout-studio: документ живёт
 * в базе, а не в localStorage.
 *
 * Проверка принадлежности проекту — не декоративная. Без неё чужой documentId
 * в адресе открыл бы планировку другого проекта той же студии.
 */
export default async function ProjectLayoutEditorPage({
  params,
}: {
  params: Promise<{ id: string; documentId: string }>;
}) {
  if (!isLayoutStudioEnabled()) notFound();
  const { id, documentId } = await params;
  const supabase = await createClient();

  const { data } = await supabase
    .from("layout_documents")
    .select("document_id, title, draft, project_id")
    .eq("document_id", documentId)
    .maybeSingle();

  const row = data as { draft: LayoutDocument; title: string; project_id: string } | null;
  if (!row || row.project_id !== id) notFound();

  return (
    <>
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 pt-4 text-sm">
        <Link href={`/dashboard/projects/${id}/layouts`} className="underline">
          ← {copy.backToList}
        </Link>
        <span className="text-neutral-400">·</span>
        <span className="text-neutral-600">{row.title || copy.untitled}</span>
        <span className="text-neutral-400">·</span>
        <span className="text-neutral-500">{copy.serverStorage}</span>
        <ForkVariantForm projectId={id} documentId={documentId} />
      </div>
      <LayoutStudioShell initialDocument={row.draft} />
    </>
  );
}
