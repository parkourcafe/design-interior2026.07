import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProjectByIntakeToken } from "@/lib/intake";
import { makeToken } from "@/lib/tokens";

export const dynamic = "force-dynamic";

// Опциональная загрузка плана/фото — ТОЛЬКО хранение, без анализа изображений.
// Метаданные пишутся в answers (question_id = 'attachments').
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const token = String(form.get("token") ?? "");
  const file = form.get("file");
  const project = await getProjectByIntakeToken(token);
  if (!project) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });

  const admin = createAdminClient();
  // Случайное имя файла в ключе Storage: не пишем оригинальное имя (может
  // содержать PII/спецсимволы). Оригинал сохраняем в метаданных answers.
  const ext = (file.name.match(/\.[A-Za-z0-9]{1,8}$/)?.[0] ?? "").toLowerCase();
  const path = `${project.id}/${makeToken(12)}${ext}`;
  const { error: uploadError } = await admin.storage
    .from("client-uploads")
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  // Дописываем метаданные в answers.attachments (массив).
  const { data: existing } = await admin
    .from("answers")
    .select("value")
    .eq("project_id", project.id)
    .eq("question_id", "attachments")
    .maybeSingle();

  const prev = Array.isArray(existing?.value) ? (existing!.value as unknown[]) : [];
  const next = [...prev, { path, name: file.name, size: file.size, type: file.type }];

  await admin
    .from("answers")
    .upsert(
      { project_id: project.id, question_id: "attachments", value: next },
      { onConflict: "project_id,question_id" },
    );

  return NextResponse.json({ ok: true, path });
}
