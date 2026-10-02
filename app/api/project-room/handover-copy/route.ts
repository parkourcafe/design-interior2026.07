import { NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { getStudio } from "@/lib/studio";
import { KIT_BUCKET, type DraftFile } from "@/lib/project-room/handover";
import { loadHandoverState } from "@/lib/project-room/handover-state";

export const dynamic = "force-dynamic";

// Безопасная копия файла для исполнителя (решение владельца 02.10.2026, B-2):
// дизайнер сам готовит файл без сумм и контактов и загружает его вместо
// исходного. Исходный файл не меняется. Копия ложится в папку подготовки
// проекта; загружает её сессия дизайнера (политика Storage проверяет студию).

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
const ProjectId = z.string().uuid();

function storageName(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) : "";
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "safe-copy";
  return ext ? `${base}.${ext}` : base;
}

export async function POST(request: Request) {
  const studio = await getStudio();
  if (!studio) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await checkRateLimit("handover_safe_copy_upload", clientIp(request), 30, 60 * 60 * 1000))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const projectId = ProjectId.safeParse(String(form.get("projectId") ?? ""));
  const sourcePath = String(form.get("sourcePath") ?? "");
  const file = form.get("file");
  if (!projectId.success || !sourcePath) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });
  if (file.size === 0 || file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "file_too_large" }, { status: 413 });
  if (!ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: "file_type" }, { status: 415 });

  const supabase = await createClient();
  const loaded = await loadHandoverState(supabase, projectId.data);
  if (!loaded.ok) return NextResponse.json({ error: loaded.reason }, { status: 409 });
  const { state } = loaded;
  if (state.kit) return NextResponse.json({ error: "kit_exists" }, { status: 409 });
  const target = state.files.find((f) => f.source_path === sourcePath);
  if (!target) return NextResponse.json({ error: "unknown_file" }, { status: 404 });

  const path = `designer-plans/${projectId.data}/handover/${Date.now()}-${storageName(file.name)}`;
  const { error: uploadError } = await supabase.storage.from(KIT_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) return NextResponse.json({ error: "upload_failed" }, { status: 502 });

  const files: DraftFile[] = state.files.map((f) => f.source_path === sourcePath
    ? {
        ...f,
        decision: "safe_copy",
        // Новую копию дизайнер должен открыть и проверить заново.
        reviewed: false,
        safe_copy: { path, name: file.name.slice(0, 200), size: file.size, content_type: file.type },
      }
    : f);
  const { error } = await supabase.from("project_handover_drafts").update({ files }).eq("id", state.draft.id);
  if (error) return NextResponse.json({ error: "save_failed" }, { status: 500 });
  return NextResponse.json({ ok: true, name: file.name, size: file.size });
}
