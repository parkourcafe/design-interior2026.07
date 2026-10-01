// DEC-047 (g), решение владельца 01.10.2026: комната проекта закрывается
// сразу после запроса удаления аккаунта студии (и до уничтожения).
// Не удалось проверить — комната закрыта (как бриф в lib/intake.ts).

export interface RoomClosureClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
  };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

export async function isRoomClosed(admin: RoomClosureClient, roomId: string): Promise<boolean> {
  const room = await admin.from("project_rooms").select("project_id").eq("id", roomId).maybeSingle();
  const projectId = (room.data as { project_id?: string | null } | null)?.project_id;
  if (room.error || !projectId) return true;
  const { data, error } = await admin.rpc("_project_in_retention", { p_project_id: projectId });
  return Boolean(error) || data === true;
}
