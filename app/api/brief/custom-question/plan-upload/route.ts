import { NextResponse } from "next/server";
import { z } from "zod";
import { extractPlanFileText } from "@/lib/brief/plan-file-text";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { createScopedServiceClient } from "@/lib/supabase/token-scoped";
import { createClient } from "@/lib/supabase/server";
import { getStudio } from "@/lib/studio";

export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ProjectId = z.string().uuid();

function safeFileName(name: string): string {
  return (
    name
      .trim()
      .replace(/[^\p{L}\p{N}._-]+/gu, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 140) || "plan"
  );
}

export async function POST(request: Request) {
  const studio = await getStudio();
  if (!studio) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!(await checkRateLimit("custom_question_plan_upload", clientIp(request), 20, 60 * 60 * 1000))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const projectId = ProjectId.safeParse(String(form.get("projectId") ?? ""));
  const file = form.get("file");
  if (!projectId.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "file_too_large" }, { status: 413 });

  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId.data)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const admin = createScopedServiceClient("authenticated-plan-upload");
  const path = `designer-plans/${projectId.data}/${Date.now()}-${safeFileName(file.name)}`;
  const { error: uploadError } = await admin.storage
    .from("client-uploads")
    .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const textExtraction = await extractPlanFileText(file);
  const meta = {
    path,
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream",
    uploaded_at: new Date().toISOString(),
    source: "designer_brief_builder",
    text_excerpt: textExtraction.excerpt,
    text_extraction: {
      status: textExtraction.status,
      source: textExtraction.source,
      chars: textExtraction.chars,
      message: textExtraction.message,
    },
  };

  const { data: existing } = await admin
    .from("answers")
    .select("value")
    .eq("project_id", projectId.data)
    .eq("question_id", "designer_plan_attachments")
    .maybeSingle();
  const prev = Array.isArray(existing?.value) ? (existing.value as unknown[]) : [];
  const next = [...prev, meta].slice(-5);

  const { error: metadataError } = await admin
    .from("answers")
    .upsert(
      { project_id: projectId.data, question_id: "designer_plan_attachments", value: next },
      { onConflict: "project_id,question_id" },
    );
  if (metadataError) return NextResponse.json({ error: metadataError.message }, { status: 500 });

  return NextResponse.json({ ok: true, file: meta });
}
