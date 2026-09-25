import { NextResponse } from "next/server";
import { createRegionalPublicTokenClient } from "@/lib/supabase/regional-admin";
import { getProjectByIntakeToken } from "@/lib/intake";
import { isIntakeOpen } from "@/lib/intake-status";

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
  // После отправки брифа intake-токен больше не пишет в проект: вложения
  // принимаются только пока бриф открыт (как и сама отправка).
  if (!isIntakeOpen(project.status)) {
    return NextResponse.json({ error: "already_submitted" }, { status: 409 });
  }
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });

  const admin = createRegionalPublicTokenClient(project.cellCode, "intake-upload");

  try {
    const path = `${project.id}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await admin.storage
      .from("client-uploads")
      .upload(path, file, { contentType: file.type, upsert: false });

    if (uploadError) throw new Error("upload_failed");

    // Дописываем метаданные в answers.attachments (массив).
    const { data: existing, error: readError } = await admin
      .from("answers")
      .select("value")
      .eq("project_id", project.id)
      .eq("question_id", "attachments")
      .maybeSingle();

    if (readError) throw new Error("attachment_read_failed");
    const prev = Array.isArray(existing?.value) ? (existing!.value as unknown[]) : [];
    const next = [...prev, { path, name: file.name, size: file.size, type: file.type }];

    const saved = await admin
      .from("answers")
      .upsert(
        { project_id: project.id, question_id: "attachments", value: next },
        { onConflict: "project_id,question_id" },
      );

    if (saved.error) throw new Error("attachment_write_failed");
    return NextResponse.json({ ok: true, path });
  } catch {
    try {
      await admin.from("events").insert({
        designer_id: project.designer_id, project_id: project.id, type: "intake_upload_failed",
      });
    } catch { /* Telemetry must not mask the operation failure. */ }
    return NextResponse.json({ error: "intake_upload_failed" }, { status: 500 });
  }
}
