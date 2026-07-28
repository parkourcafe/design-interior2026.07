import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProjectByIntakeToken } from "@/lib/intake";
import {
  CLIENT_UPLOAD_MAX_FILE_BYTES,
  ClientUploadRequestTooLargeError,
  clientUploadMimeType,
  clientUploadObjectPath,
  declaredUploadRequestTooLarge,
  readBoundedUploadBody,
  sanitizeClientUploadDisplayName,
} from "@/lib/storage/client-upload";

export const dynamic = "force-dynamic";

// Опциональная загрузка плана/фото — ТОЛЬКО хранение, без анализа изображений.
// Метаданные пишутся в answers (question_id = 'attachments').
export async function POST(request: Request) {
  if (declaredUploadRequestTooLarge(request.headers)) {
    return NextResponse.json(
      { error: "request_too_large" },
      { status: 413 },
    );
  }

  let body: ArrayBuffer | null;
  try {
    body = await readBoundedUploadBody(request);
  } catch (error) {
    if (error instanceof ClientUploadRequestTooLargeError) {
      return NextResponse.json(
        { error: "request_too_large" },
        { status: 413 },
      );
    }
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  if (!body) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const boundedRequest = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body,
  });
  const form = await boundedRequest.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const tokenEntry = form.get("token");
  const token = typeof tokenEntry === "string" ? tokenEntry.trim() : "";
  const files = form.getAll("file");
  const file = files.length === 1 ? files[0] : null;
  if (token.length < 1 || token.length > 128) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const project = await getProjectByIntakeToken(token);
  if (!project) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!project.designer_id) {
    return NextResponse.json(
      { error: "intake_owner_required" },
      { status: 409 },
    );
  }
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });
  if (file.size > CLIENT_UPLOAD_MAX_FILE_BYTES) {
    return NextResponse.json({ error: "file_too_large" }, { status: 413 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "empty_file" }, { status: 400 });
  }

  const mimeType = clientUploadMimeType(file.type);
  if (!mimeType) {
    return NextResponse.json(
      { error: "unsupported_file_type" },
      { status: 415 },
    );
  }

  const admin = createAdminClient();
  const path = clientUploadObjectPath(project.id, mimeType);
  const { error: uploadError } = await admin.storage
    .from("client-uploads")
    .upload(path, file, { contentType: mimeType, upsert: false });

  if (uploadError) {
    return NextResponse.json({ error: "upload_failed" }, { status: 502 });
  }

  // Дописываем метаданные в answers.attachments (массив).
  const { data: existing, error: readError } = await admin
    .from("answers")
    .select("value")
    .eq("project_id", project.id)
    .eq("question_id", "attachments")
    .maybeSingle();

  if (readError) {
    await admin.storage.from("client-uploads").remove([path]);
    return NextResponse.json({ error: "metadata_write_failed" }, { status: 502 });
  }

  const prev = Array.isArray(existing?.value) ? (existing!.value as unknown[]) : [];
  const next = [
    ...prev,
    {
      path,
      name: sanitizeClientUploadDisplayName(file.name, mimeType),
      size: file.size,
      type: mimeType,
    },
  ];

  const { error: writeError } = await admin
    .from("answers")
    .upsert(
      { project_id: project.id, question_id: "attachments", value: next },
      { onConflict: "project_id,question_id" },
    );

  if (writeError) {
    await admin.storage.from("client-uploads").remove([path]);
    return NextResponse.json({ error: "metadata_write_failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
