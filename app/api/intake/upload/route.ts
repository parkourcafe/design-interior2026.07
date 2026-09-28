import { NextResponse } from "next/server";
import { createRegionalPublicTokenClient } from "@/lib/supabase/regional-admin";
import { getProjectByIntakeToken } from "@/lib/intake";
import { isIntakeOpen } from "@/lib/intake-status";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import {
  CLIENT_UPLOAD_MAX_BYTES,
  CLIENT_UPLOAD_MAX_FILES,
  clientFileDisplayName,
  safeClientFileName,
  sniffClientUpload,
} from "@/lib/brief/client-upload-policy";

export const dynamic = "force-dynamic";

// Опциональная загрузка плана/фото — ТОЛЬКО хранение, без анализа изображений.
// Метаданные пишутся в answers (question_id = 'attachments') атомарной
// функцией базы append_intake_attachment: с лимитом числа файлов и без потери
// записей при одновременных загрузках.
export async function POST(request: Request) {
  // Размер — до разбора формы: не читаем в память заведомо лишнее.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > CLIENT_UPLOAD_MAX_BYTES + 64 * 1024) {
    return NextResponse.json({ error: "file_too_large" }, { status: 413 });
  }
  if (!(await checkRateLimit("intake_upload", clientIp(request), 40, 60 * 60 * 1000))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const token = String(form.get("token") ?? "");
  const file = form.get("file");
  const project = await getProjectByIntakeToken(token);
  if (!project) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // DEC-044 (a): студия закрывает аккаунт — бриф только для чтения. Отказ до
  // любой записи (в том числе до загрузки файла в хранилище).
  if (project.archived) return NextResponse.json({ error: "brief_closed" }, { status: 409 });
  // После отправки брифа intake-токен больше не пишет в проект: вложения
  // принимаются только пока бриф открыт (как и сама отправка).
  if (!isIntakeOpen(project.status)) {
    return NextResponse.json({ error: "already_submitted" }, { status: 409 });
  }
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });
  if (file.size === 0 || file.size > CLIENT_UPLOAD_MAX_BYTES) {
    return NextResponse.json({ error: "file_too_large" }, { status: 413 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffClientUpload(bytes.subarray(0, 16));
  if (!kind) return NextResponse.json({ error: "unsupported_file_type" }, { status: 415 });

  const admin = createRegionalPublicTokenClient(project.cellCode, "intake-upload");

  // Лимит числа файлов проверяется до загрузки (не заливать лишнее) и ещё раз
  // атомарно при записи метаданных (гонка двух вкладок).
  const { data: existing, error: readError } = await admin
    .from("answers")
    .select("value")
    .eq("project_id", project.id)
    .eq("question_id", "attachments")
    .maybeSingle();
  if (!readError && Array.isArray(existing?.value) && existing.value.length >= CLIENT_UPLOAD_MAX_FILES) {
    return NextResponse.json({ error: "too_many_files" }, { status: 409 });
  }

  const path = `${project.id}/${Date.now()}-${safeClientFileName(file.name, kind.extension)}`;
  const name = clientFileDisplayName(file.name);
  let uploaded = false;
  try {
    const { error: uploadError } = await admin.storage
      .from("client-uploads")
      .upload(path, bytes, { contentType: kind.mediaType, upsert: false });
    if (uploadError) throw new Error("upload_failed");
    uploaded = true;

    const appended = await admin.rpc("append_intake_attachment", {
      p_project_id: project.id,
      p_item: { path, name, size: file.size, type: kind.mediaType },
      p_max_files: CLIENT_UPLOAD_MAX_FILES,
    });
    if (appended.error) throw new Error("attachment_write_failed");
    if ((appended.data as { ok?: boolean } | null)?.ok !== true) {
      await admin.storage.from("client-uploads").remove([path]);
      return NextResponse.json({ error: "too_many_files" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, path });
  } catch {
    // Метаданные не записались — убрать только что загруженный объект, чтобы
    // в хранилище не оставалось файлов, о которых проект не знает.
    if (uploaded) {
      try { await admin.storage.from("client-uploads").remove([path]); } catch { /* best effort */ }
    }
    try {
      await admin.from("events").insert({
        designer_id: project.designer_id, project_id: project.id, type: "intake_upload_failed",
      });
    } catch { /* Telemetry must not mask the operation failure. */ }
    return NextResponse.json({ error: "intake_upload_failed" }, { status: 500 });
  }
}
