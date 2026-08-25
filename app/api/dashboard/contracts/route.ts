import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createHash } from "node:crypto";

export const dynamic = "force-dynamic";

// B3 (Фаза 2): внешний договор проекта. Приватный бакет contract-documents,
// ключ непрозрачный (bucket/projectId/sha256), checksum считает СЕРВЕР,
// имя файла — только в metadata строки (не в ключе, не в логах).
// Статусная машина uploaded→received→signed→archived под триггером в базе.

const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED = ["application/pdf"] as const;

async function requireOwnedProject(projectId: string) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return { supabase, error: "unauthenticated" as const };
  const { data: project } = await supabase
    .from("projects")
    .select("id, designer_id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { supabase, error: "not_found" as const };
  if (project.designer_id !== user.id) {
    return { supabase, error: "forbidden" as const };
  }
  return { supabase, project, error: null };
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const projectId = form?.get("projectId");
  const file = form?.get("file");
  if (!form || typeof projectId !== "string" || !(file instanceof File)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!ALLOWED.includes(file.type as (typeof ALLOWED)[number])) {
    return NextResponse.json({ error: "unsupported_type" }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }

  const { supabase, project, error } = await requireOwnedProject(projectId);
  if (error === "unauthenticated") {
    return NextResponse.json({ error }, { status: 401 });
  }
  if (error || !project) {
    return NextResponse.json({ error: error ?? "not_found" }, { status: 403 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const storagePath = `contract-documents/${projectId}/${sha256}`;

  const { error: uploadError } = await supabase.storage
    .from("contract-documents")
    .upload(storagePath, bytes, {
      contentType: file.type,
      upsert: false,
    });
  if (uploadError) {
    const duplicate = uploadError.message.includes("already exists");
    if (!duplicate) {
      return NextResponse.json({ error: "upload_failed" }, { status: 500 });
    }
  }

  const { data: row, error: insertError } = await supabase
    .from("contract_documents")
    .insert({
      project_id: projectId,
      storage_path: storagePath,
      original_name: file.name.slice(0, 255),
      sha256,
      size_bytes: file.size,
      status: "uploaded",
    })
    .select("id, status")
    .maybeSingle();
  if (insertError || !row) {
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }
  return NextResponse.json({ id: row.id, status: row.status });
}

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    projectId?: string;
    documentId?: string;
    status?: string;
  };
  if (
    typeof body.projectId !== "string"
    || typeof body.documentId !== "string"
    || typeof body.status !== "string"
    || !["received", "signed", "archived"].includes(body.status)
  ) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const { supabase, error } = await requireOwnedProject(body.projectId);
  if (error === "unauthenticated") {
    return NextResponse.json({ error }, { status: 401 });
  }
  if (error) {
    return NextResponse.json({ error: error ?? "not_found" }, { status: 403 });
  }

  const { data, error: updateError } = await supabase
    .from("contract_documents")
    .update({ status: body.status })
    .eq("id", body.documentId)
    .eq("project_id", body.projectId)
    .select("id, status")
    .maybeSingle();
  if (updateError) {
    // 55000 из триггера переходов — нелегальный шаг статусной машины.
    return NextResponse.json({ error: "illegal_transition" }, { status: 409 });
  }
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ id: data.id, status: data.status });
}
