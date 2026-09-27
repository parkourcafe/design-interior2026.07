// DEC-042 (4) и DEC-041 §4: baseline M3 публикуется только с опубликованной
// передачей M2→M3 по каждой комнате с утверждённым клиентом дизайном и хотя бы
// с одной передачей в каждом пакете (миграции 20260925100000, 20260928090000).
// Свежесть комнат считает сервер (projectceo_read_api.get_m3_room_handoff_readiness)
// тем же расчётом, которым её перепроверяет дверь publish_baseline_atomic:
// здесь только собираются ссылки из этого ответа. Клиент их не присылает.

export interface RoomHandoffReadiness {
  readonly packageId: string;
  readonly roomId: string;
  /** У комнаты есть утверждённый клиентом дизайн — передача обязательна. */
  readonly applicable: boolean;
  readonly handoffId: string | null;
  readonly handoffRevisionId: string | null;
  /** null — передача свежая; иначе причина (M2_HANDOFF_MISSING, M2_HANDOFF_STALE, …). */
  readonly problem: string | null;
}

export interface BaselineRoomHandoffRef {
  readonly packageId: string;
  readonly roomId: string;
  readonly handoffId: string;
  readonly handoffRevisionId: string;
}

export interface BlockedRoom {
  readonly packageId: string;
  readonly roomId: string;
  readonly problem: string;
}

/** Ответ сервера о готовности: комнаты и утверждённые selection вне передач. */
export interface RoomHandoffReadinessReport {
  readonly rooms: readonly RoomHandoffReadiness[];
  readonly unboundSelectionRevisionIds: readonly string[];
}

export type BaselineHandoffRefsResult =
  | { readonly ok: true; readonly refs: readonly BaselineRoomHandoffRef[] }
  | {
    readonly ok: false;
    readonly missingPackageIds: readonly string[];
    readonly blockedRooms: readonly BlockedRoom[];
    /** Утверждённые материалы, которых нет ни в одной свежей передаче. */
    readonly unboundSelectionRevisionIds: readonly string[];
  };

export function baselineRoomHandoffRefs(
  packageIds: readonly string[],
  report: RoomHandoffReadinessReport,
): BaselineHandoffRefsResult {
  const { rooms, unboundSelectionRevisionIds } = report;
  const active = new Set(packageIds);
  const refs: BaselineRoomHandoffRef[] = [];
  const blockedRooms: BlockedRoom[] = [];
  for (const room of rooms) {
    if (!active.has(room.packageId)) continue;
    const fresh = room.problem === null && room.handoffId !== null && room.handoffRevisionId !== null;
    if (fresh) {
      refs.push({
        packageId: room.packageId,
        roomId: room.roomId,
        handoffId: room.handoffId!,
        handoffRevisionId: room.handoffRevisionId!,
      });
    } else if (room.applicable) {
      // Комната с утверждённым дизайном без свежей передачи блокирует baseline.
      // Комната без утверждённого дизайна с несвежей передачей в baseline не
      // обязана входить — её просто не берём.
      blockedRooms.push({
        packageId: room.packageId,
        roomId: room.roomId,
        problem: room.problem ?? "M2_HANDOFF_MISSING",
      });
    }
  }
  const covered = new Set(refs.map((ref) => ref.packageId));
  const missingPackageIds = packageIds.filter((packageId) => !covered.has(packageId));
  if (missingPackageIds.length > 0 || blockedRooms.length > 0 || unboundSelectionRevisionIds.length > 0) {
    return { ok: false, missingPackageIds, blockedRooms, unboundSelectionRevisionIds };
  }
  const order = new Map(packageIds.map((packageId, index) => [packageId, index]));
  refs.sort((left, right) => (
    (order.get(left.packageId)! - order.get(right.packageId)!)
    || (left.roomId < right.roomId ? -1 : left.roomId > right.roomId ? 1 : 0)
  ));
  return { ok: true, refs };
}
