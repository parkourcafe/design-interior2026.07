import type {
  ProjectCeoCapability,
  ProjectCeoRole,
  ProjectCeoTab,
} from "./contracts";

const ROLE_CAPABILITIES: Readonly<Record<ProjectCeoRole, readonly ProjectCeoCapability[]>> = {
  owner: [
    "view_project",
    "manage_project",
    "manage_access",
    "register_source",
    "review_source",
    "review_claim",
    "create_selection",
    "review_selection",
    "publish_baseline",
    "publish_release",
    "distribute_release",
    "acknowledge_release",
    "revise_decision",
    "create_change",
    "review_change_impact",
    "upload_photo_evidence",
    "review_milestone",
    "view_audit",
    "manage_budget",
    "prepare_client_handoff",
  ],
  architect: [
    "view_project",
    "register_source",
    "review_source",
    "review_claim",
    "create_selection",
    "review_selection",
    "publish_baseline",
    "publish_release",
    "distribute_release",
    "acknowledge_release",
    "revise_decision",
    "create_change",
    "review_change_impact",
    "upload_photo_evidence",
    "review_milestone",
    "view_audit",
    "manage_budget",
    "prepare_client_handoff",
  ],
  builder: [
    "view_project",
    "register_source",
    "create_selection",
    "acknowledge_release",
    "revise_decision",
    "create_change",
    "upload_photo_evidence",
    "review_milestone",
  ],
  client: [
    "view_project",
    "review_selection",
    "acknowledge_release",
    "revise_decision",
    "create_change",
    "review_milestone",
  ],
  guest: [
    "view_project",
    "acknowledge_release",
  ],
};

const TAB_CAPABILITY: Readonly<Record<ProjectCeoTab, ProjectCeoCapability>> = {
  overview: "view_project",
  sources: "review_source",
  decisions: "view_project",
  // Пакет документации готовит студийная сторона — то же право, что открывает
  // публикацию входа M3 и регистрацию листа на сервере.
  documentation: "prepare_client_handoff",
  baseline: "view_project",
  releases: "view_project",
  changes: "create_change",
  participants: "manage_access",
  history: "view_audit",
};

const PARTICIPANT_TABS: readonly ProjectCeoTab[] = [
  "overview",
  "decisions",
  "baseline",
  "releases",
  "changes",
];

export function capabilitiesForRole(
  role: ProjectCeoRole,
): readonly ProjectCeoCapability[] {
  return ROLE_CAPABILITIES[role];
}

export function can(
  role: ProjectCeoRole,
  capability: ProjectCeoCapability,
): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

export function visibleTabsForRole(role: ProjectCeoRole): readonly ProjectCeoTab[] {
  if (role === "guest") return ["overview", "releases"];
  if (role === "client") return PARTICIPANT_TABS;
  // Строителю сервер разрешает register_source; без вкладки источников это
  // право было бы мёртвым аффордансом — команда есть, поверхности нет.
  if (role === "builder") return ["overview", "sources", ...PARTICIPANT_TABS.slice(1)];
  return (Object.keys(TAB_CAPABILITY) as ProjectCeoTab[]).filter((tab) => (
    can(role, TAB_CAPABILITY[tab])
  ));
}

export function assertExactPackageScope(input: {
  readonly role: ProjectCeoRole;
  readonly actorPackageId: string | null;
  readonly requestedPackageId: string | null;
}): boolean {
  if (input.role !== "guest") return true;
  return (
    input.actorPackageId !== null
    && input.requestedPackageId === input.actorPackageId
  );
}
