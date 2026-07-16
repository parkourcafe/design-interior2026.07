import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const CONFIRMATION = "УДАЛИТЬ";

async function removeProjectFiles(projectIds: string[]) {
  const admin = createAdminClient();

  for (const projectId of projectIds) {
    const paths: string[] = [];
    let offset = 0;

    while (true) {
      const { data, error } = await admin.storage
        .from("client-uploads")
        .list(projectId, { limit: 100, offset });

      if (error) throw error;
      const files = (data ?? []).filter((item) => item.name && item.id);
      paths.push(...files.map((item) => `${projectId}/${item.name}`));
      if ((data ?? []).length < 100) break;
      offset += 100;
    }

    if (paths.length > 0) {
      const { error } = await admin.storage.from("client-uploads").remove(paths);
      if (error) throw error;
    }
  }
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Не авторизован." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { confirmation?: unknown };
  if (body.confirmation !== CONFIRMATION) {
    return NextResponse.json(
      { error: `Для подтверждения введите «${CONFIRMATION}».` },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Если пользователь владеет студией, удаление auth.users каскадно удалит
  // designers → projects → answers/risks/proposals/events. Файлы Storage не
  // участвуют в FK-cascade, поэтому удаляем их до удаления пользователя.
  const { data: ownedProjects, error: projectsError } = await admin
    .from("projects")
    .select("id")
    .eq("designer_id", user.id);

  if (projectsError) {
    return NextResponse.json({ error: "Не удалось подготовить удаление данных." }, { status: 500 });
  }

  try {
    await removeProjectFiles((ownedProjects ?? []).map(({ id }) => String(id)));
  } catch {
    return NextResponse.json(
      { error: "Не удалось удалить загруженные файлы. Аккаунт не был удалён." },
      { status: 500 },
    );
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    return NextResponse.json({ error: "Не удалось удалить аккаунт." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
