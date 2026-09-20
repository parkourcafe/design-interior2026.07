// Action/Skill Registry (Фаза 2, A3; строка 10 матрицы готовности).
//
// Единый реестр действий платформы: какая команда, к какому модулю
// относится, какой capability требует и чем авторизована. Источник имён
// команд — `projectCeoCommandSchema` (command-contract.ts); тест
// `tests/platform/action-registry.test.ts` роняет CI, если в контракте
// появилась команда, которой нет в реестре (образец A6 §5.1), и — обратно —
// если в реестре есть призрак.
//
// ЧЕГО ЗДЕСЬ НЕТ (честно, следующий инкремент): переключения
// `live-read-port.ts`/`role-policy.ts` на чтение capability ИЗ этого
// реестра. Сейчас реестр — зеркало и контролёр; единым источником
// поверхности он станет аддитивным следующим шагом, после того как
// зеркальность закрепится тестом.

export type PlatformModule =
  | "access"
  | "m2"
  | "m3"
  | "m4"
  | "platform";

export type ActionStatus =
  /** Открыта и авторизована подписанным документом. */
  | "active"
  /** Системная операция: человеческой поверхности нет и не будет. */
  | "worker_only"
  /** Не авторизована никаким документом (V2/V3, закрытые двери). */
  | "not_authorized";

export interface RegisteredAction {
  readonly kind: string;
  readonly module: PlatformModule;
  /** null — у команды нет capability-гейта (identity-операции). */
  readonly capability: string | null;
  readonly status: ActionStatus;
  /** Чем авторизовано — документ, миграция или живой источник карты. */
  readonly basis: string;
}

const REGISTRY_ENTRIES: readonly RegisteredAction[] = [
  // --- M1: project facts and approval gate -------------------------------
  { kind: "create_project_fact", module: "platform", capability: "review_source", status: "active", basis: "20260824130000 + command-service.ts" },
  { kind: "create_approval_request", module: "platform", capability: "view_project", status: "active", basis: "20260824150000 + command-service.ts" },
  { kind: "submit_approval_request", module: "platform", capability: "view_project", status: "active", basis: "20260824150000 + command-service.ts" },
  { kind: "decide_approval_request", module: "platform", capability: null, status: "active", basis: "20260824150000 + command-service.ts (request capability is server-selected)" },
  // --- Access --------------------------------------------------------------
  { kind: "create_invitation", module: "access", capability: "manage_access", status: "active", basis: "live-read-port.ts:1171" },
  { kind: "revoke_invitation", module: "access", capability: "manage_access", status: "active", basis: "live-read-port.ts:1174" },
  { kind: "revoke_guest_grant", module: "access", capability: "manage_access", status: "active", basis: "live-read-port.ts:1175" },

  // --- M3: источники и документация (A5/DEC-024) ---------------------------
  { kind: "register_source", module: "m3", capability: "register_source", status: "active", basis: "live-read-port.ts:1190 (flag-gated)" },
  { kind: "review_source", module: "m3", capability: "review_source", status: "active", basis: "live-read-port.ts:1215 (review_claim && review_source)" },
  { kind: "publish_baseline", module: "m3", capability: "publish_baseline", status: "active", basis: "live-read-port.ts:1259 (A′-оркестрация, flag-gated)" },
  { kind: "register_documentation_sheet", module: "m3", capability: "prepare_client_handoff", status: "active", basis: "live-read-port.ts:1196" },
  { kind: "attach_documentation_sheet_specifications", module: "m3", capability: "prepare_client_handoff", status: "active", basis: "live-read-port.ts:1202" },
  {kind:"bind_pdf_dwg_sheet_sidecar",module:"m3",capability:"review_source",status:"active",basis:"R1-08A private declared sheet sidecar"},
  { kind: "confirm_pdf_dwg_source_pair", module: "m3", capability: "review_source", status: "active", basis: "R1-08A architect source-pair confirmation" },
  { kind: "attach_external_release_refs", module: "m3", capability: "prepare_client_handoff", status: "active", basis: "R1-10 / 20260912110000_r1_external_release_attachment_manifest.sql" },
  { kind: "publish_release", module: "m3", capability: "publish_release", status: "active", basis: "live-read-port.ts:1268" },

  // --- M2: дизайн-воркспейс (A4/DEC-021) -----------------------------------
  { kind: "create_decision", module: "m2", capability: "revise_decision", status: "active", basis: "live-read-port.ts:1215" },
  { kind: "create_selection", module: "m2", capability: "create_selection", status: "active", basis: "live-read-port.ts:1218" },
  { kind: "create_m2_room", module: "m2", capability: "revise_decision", status: "active", basis: "live-read-port.ts:1221" },
  { kind: "create_m2_variant", module: "m2", capability: "revise_decision", status: "active", basis: "live-read-port.ts:1224" },
  { kind: "create_m2_material", module: "m2", capability: "create_selection", status: "active", basis: "live-read-port.ts:1227" },
  { kind: "set_m2_budget", module: "m2", capability: "manage_budget", status: "active", basis: "live-read-port.ts:1230" },
  { kind: "create_m2_client_handoff", module: "m2", capability: "prepare_client_handoff", status: "active", basis: "live-read-port.ts:1233" },
  { kind: "create_approval_package", module: "m2", capability: "review_claim", status: "active", basis: "live-read-port.ts:1236" },
  { kind: "submit_approval_package", module: "m2", capability: "review_claim", status: "active", basis: "live-read-port.ts:1239" },
  { kind: "review_selection", module: "m2", capability: "review_selection", status: "active", basis: "live-read-port.ts:1242" },
  { kind: "commit_m2_approval", module: "m2", capability: "revise_decision", status: "active", basis: "20260802080000 (appendM2WorkspaceRevision, контракт-тест)" },
  { kind: "publish_m2_layout_version", module: "m2", capability: "revise_decision", status: "active", basis: "20260802080000 (контракт-тест: публикация с revise_decision)" },
  { kind: "submit_m2_client_review", module: "m2", capability: "review_selection", status: "active", basis: "20260802090000" },
  { kind: "review_m2_client_submission", module: "m2", capability: "review_selection", status: "active", basis: "20260802090000:414" },
  { kind: "publish_m2_m3_handoff", module: "m2", capability: "prepare_client_handoff", status: "active", basis: "20260802090000:282" },

  // --- M4: исполнение (A6/DEC-025; V1 DEC-033) ------------------------------
  { kind: "distribute_release", module: "m4", capability: "distribute_release", status: "active", basis: "live-read-port.ts:1276 (инкремент 1, DEC-025)" },
  { kind: "acknowledge_release", module: "m4", capability: "acknowledge_release", status: "active", basis: "live-read-port.ts:1282 (инкремент 1)" },
  { kind: "create_change", module: "m4", capability: "create_change", status: "active", basis: "live-read-port.ts:1288 (инкремент 1)" },
  { kind: "review_change_impact", module: "m4", capability: "review_change_impact", status: "active", basis: "live-read-port.ts:1298 (V1, DEC-033)" },
  // Закрытая навсегда дверь (DEC-034): в реестре остаётся как документ
  // запрета — поверхность отдаёт increment_not_authorized.
  { kind: "acknowledge_impact_truncation", module: "m4", capability: "review_change_impact", status: "not_authorized", basis: "DEC-034 (20260813010000: revoke навсегда)" },
  // V2 Field Evidence — NOT AUTHORIZED (DEC-032) до M4 IMPLEMENTATION GO.
  { kind: "upload_photo_evidence", module: "m4", capability: "upload_photo_evidence", status: "not_authorized", basis: "DEC-032 (V2)" },
  { kind: "review_photo_evidence", module: "m4", capability: "review_milestone", status: "not_authorized", basis: "DEC-032 (V2)" },
  { kind: "accept_milestone", module: "m4", capability: "review_milestone", status: "not_authorized", basis: "DEC-032 (V2)" },
  // V3 Handover — системная операция воркера, человеческой двери нет.
  { kind: "build_handover", module: "m4", capability: null, status: "worker_only", basis: "DEC-032 (V3, worker-only)" },
];

const REGISTRY: ReadonlyMap<string, RegisteredAction> = new Map(
  REGISTRY_ENTRIES.map((entry) => [entry.kind, entry]),
);

export function getActionRegistry(): readonly RegisteredAction[] {
  return REGISTRY_ENTRIES;
}

export function getRegisteredAction(kind: string): RegisteredAction | undefined {
  return REGISTRY.get(kind);
}

/**
 * Контроль полноты (A6 §5.1): каждый kind из контракта обязан быть в
 * реестре. Неучтённая команда — красный CI, а не тихая дыра в карте.
 * Возвращает список отсутствующих — тест решает, как упасть.
 */
export function findUnregisteredCommands(
  contractKinds: readonly string[],
): readonly string[] {
  return contractKinds.filter((kind) => !REGISTRY.has(kind));
}

/** Обратный контроль: в реестре нет призраков, которых нет в контракте. */
export function findRegistryGhosts(
  contractKinds: readonly string[],
): readonly string[] {
  const known = new Set(contractKinds);
  return REGISTRY_ENTRIES.filter((entry) => !known.has(entry.kind)).map(
    (entry) => entry.kind,
  );
}
