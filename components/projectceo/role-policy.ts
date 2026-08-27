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
  baseline: "view_project",
  releases: "view_project",
  changes: "create_change",
  participants: "manage_access",
  history: "view_audit",
};

const BUILDER_TABS: readonly ProjectCeoTab[] = [
  "overview",
  "releases",
];

const CLIENT_TABS: readonly ProjectCeoTab[] = [
  "overview",
  "decisions",
  "baseline",
  "releases",
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
  if (role === "builder") return BUILDER_TABS;
  if (role === "client") return CLIENT_TABS;
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
