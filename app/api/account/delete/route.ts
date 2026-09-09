import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createScopedServiceClient } from "@/lib/supabase/token-scoped";

export const dynamic = "force-dynamic";

const CONFIRMATION = "УДАЛИТЬ";
type AdminClient = ReturnType<typeof createScopedServiceClient>;

async function listProjectFiles(admin: AdminClient, rootPrefix: string): Promise<string[]> {
  const paths: string[] = [];
  const pendingPrefixes = [rootPrefix];

  while (pendingPrefixes.length > 0) {
    const prefix = pendingPrefixes.shift()!;
    let offset = 0;

    while (true) {
      const { data, error } = await admin.storage
        .from("client-uploads")
        .list(prefix, { limit: 100, offset });

      if (error) throw error;
      for (const item of data ?? []) {
        if (!item.name || item.name === "." || item.name === "..") continue;
        const path = `${prefix}/${item.name}`;
        if (item.id) paths.push(path);
        else pendingPrefixes.push(path);
      }
      if ((data ?? []).length < 100) break;
      offset += 100;
    }
  }

  return paths;
}

async function removeProjectFiles(admin: AdminClient, projectIds: string[]) {
  for (const projectId of projectIds) {
    const paths = [
      ...(await listProjectFiles(admin, projectId)),
      ...(await listProjectFiles(admin, `designer-plans/${projectId}`)),
    ];

    for (let start = 0; start < paths.length; start += 1000) {
      const { error } = await admin.storage
        .from("client-uploads")
        .remove(paths.slice(start, start + 1000));
      if (error) throw error;
    }
  }
}

async function anonymizeAccountData(admin: AdminClient, userId: string, projectIds: string[]) {
  // Участник больше не должен отображаться в командах и проектных комнатах.
  // У владельца также удаляем приглашения команды: в них хранятся email других
  // людей, которые больше не нужны после закрытия студии.
  const memberCleanup = await admin.from("studio_members").delete().eq("member_id", userId);
  if (memberCleanup.error) throw memberCleanup.error;

  const ownedTeamCleanup = await admin.from("studio_members").delete().eq("owner_id", userId);
  if (ownedTeamCleanup.error) throw ownedTeamCleanup.error;

  const participantCleanup = await admin
    .from("project_participants")
    .update({ display_name: "", access_token: null, auth_user_id: null })
    .eq("auth_user_id", userId);
  if (participantCleanup.error) throw participantCleanup.error;

  if (projectIds.length > 0) {
    // Эти таблицы содержат пользовательский контент, а не обязательный
    // неизменяемый аудит. Проекты могут уже участвовать в append-only
    // Project Intelligence и поэтому не удаляются физически: оставляем только
    // обезличенный технический каркас и отзываем все публичные токены.
    for (const table of ["project_rooms", "answers", "risk_cards", "proposals"] as const) {
      const cleanup = await admin.from(table).delete().in("project_id", projectIds);
      if (cleanup.error) throw cleanup.error;
    }

    for (const projectId of projectIds) {
      const projectCleanup = await admin
        .from("projects")
        .update({
          client_name: "",
          passport: null,
          custom_questions: [],
          intake_token: crypto.randomUUID(),
        })
        .eq("id", projectId);
      if (projectCleanup.error) throw projectCleanup.error;
    }
  }

  // Строка designers может быть связана с неизменяемым аудитом через
  // ON DELETE RESTRICT. Сохраняем UUID как псевдонимный технический ключ,
  // удаляя из профиля все идентифицирующие и коммерческие данные.
  const designerCleanup = await admin
    .from("designers")
    .update({
      name: "",
      studio_name: "",
      pricing: null,
      proposal_defaults: {},
      profile: {},
    })
    .eq("id", userId);
  if (designerCleanup.error) throw designerCleanup.error;
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

  const admin = createScopedServiceClient("authenticated-account-delete");

  // Сначала находим принадлежащие пользователю проекты: их файлы и содержимое
  // должны быть удалены до отзыва учётной записи.
  const { data: ownedProjects, error: projectsError } = await admin
    .from("projects")
    .select("id")
    .eq("designer_id", user.id);

  if (projectsError) {
    return NextResponse.json({ error: "Не удалось подготовить удаление данных." }, { status: 500 });
  }

  try {
    const projectIds = (ownedProjects ?? []).map(({ id }) => String(id));
    await removeProjectFiles(admin, projectIds);
    await anonymizeAccountData(admin, user.id, projectIds);
  } catch {
    return NextResponse.json(
      { error: "Не удалось удалить данные аккаунта. Учётная запись не была закрыта." },
      { status: 500 },
    );
  }

  // Документированный soft-delete Supabase необратим: учётная запись больше не
  // используется для входа, а в Auth сохраняется хешированный user ID. Это не
  // разрывает ON DELETE RESTRICT-ссылки неизменяемого аудита.
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id, true);
  if (deleteError) {
    return NextResponse.json({ error: "Не удалось удалить аккаунт." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
