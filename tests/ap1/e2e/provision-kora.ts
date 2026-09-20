import { execFileSync } from "node:child_process";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import goldenJson from "@/fixtures/project-intelligence/kora/kora-project-brain-golden.json";
import {
  planSourceImport,
  type KoraInventoryRecord,
} from "@/lib/project-intelligence/modules/package";
import type { KoraProjectBrainGolden } from "@/lib/project-intelligence/modules/package/kora-golden";

const PROJECT_ID = "41111111-1111-4111-8111-111111111111";
const ROOT_PACKAGE_ID = PROJECT_ID;
const PACKAGE_IDS = {
  architecture: PROJECT_ID,
  engineering: "49999999-9999-4999-8999-999999999998",
  controls: "49999999-9999-4999-8999-999999999997",
  site: "49999999-9999-4999-8999-999999999996",
} as const;

const EXTERNAL_ORGANIZATION_ID = "a1111111-1111-4111-8111-111111111111";
const EXTERNAL_PROJECT_ID = "a2222222-2222-4222-8222-222222222222";
const EXTERNAL_PACKAGE_ID = "a3333333-3333-4333-8333-333333333333";
const EXTERNAL_AREA_NODE_ID = "tashkent-area";
const EXTERNAL_DESIGN_INTENT_NODE_ID = "tashkent-design-intent";
const EXTERNAL_DESIGN_INTENT_REVISION_ID = "tashkent-design-intent-r1";
const KORA_AREA_NODE_ID = "kora-site-progress-area";
const KORA_AREA_REVISION_ID = "kora-site-progress-area-r1";

type ExternalManifest = {
  readonly scope: { readonly organizationId: string; readonly projectId: string; readonly packageId: string };
  readonly sources: readonly { readonly externalRef: string; readonly checksum: string; readonly sheet: string; readonly fragment: string; readonly page: number }[];
  readonly m2: {
    readonly roomId: string;
    readonly approvalPackageId: string;
    readonly budgetAsOf: string;
    readonly staleAfterDays: number;
    readonly submissionId: string;
    readonly submissionRevisionId: string;
    readonly reviewRevisionId: string;
    readonly handoffId: string;
    readonly handoffRevisionId: string;
    readonly variants: readonly {
      readonly variantId: string;
      readonly role: string;
      readonly layoutDocumentId: string;
      readonly layoutVersionId: string;
      readonly layoutRevisionId: string;
      readonly semanticHash: string;
      readonly selectionRevisionIds: readonly string[];
      readonly budget: { readonly amountRub: number };
      readonly layoutContent: Record<string, unknown>;
    }[];
  };
};

const GOLDEN_PACKAGE_MAP = new Map<string, string>([
  ["33333333-3333-4333-8333-333333333333", ROOT_PACKAGE_ID],
  ["44444444-4444-4444-8444-444444444441", ROOT_PACKAGE_ID],
  ["44444444-4444-4444-8444-444444444442", ROOT_PACKAGE_ID],
  ["44444444-4444-4444-8444-444444444443", ROOT_PACKAGE_ID],
  ["44444444-4444-4444-8444-444444444444", ROOT_PACKAGE_ID],
]);

type Ap1Role = "owner" | "architect" | "builder" | "client" | "guest";

interface LocalStatus {
  readonly API_URL?: string;
  readonly ANON_KEY?: string;
  readonly SERVICE_ROLE_KEY?: string;
  readonly api?: { readonly url?: string; readonly anon_key?: string };
  readonly auth?: { readonly service_role_key?: string };
}

interface ProvisionedUser {
  readonly role: Ap1Role;
  readonly email: string;
  readonly id: string;
  readonly password: string;
}

type ExternalUser = Pick<ProvisionedUser, "role" | "email" | "id">;

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`AP1_MISSING_${name}`);
  return value;
}

function assertLoopback(rawUrl: string): void {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("AP1_NON_LOOPBACK_SUPABASE_REJECTED");
  }
}

function psql(container: string, sql: string): void {
  if (!/^supabase_db_[a-zA-Z0-9_.-]+$/.test(container)) {
    throw new Error("AP1_DB_CONTAINER_INVALID");
  }
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "--set",
      "ON_ERROR_STOP=1",
      "--username",
      "postgres",
      "--dbname",
      "postgres",
    ],
    { input: sql, stdio: ["pipe", "ignore", "pipe"] },
  );
}

async function rpc<T>(
  client: SupabaseClient,
  schema: string,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await client.schema(schema).rpc(fn, args);
  if (error) {
    const reason = [error.code, error.message, error.details, error.hint]
      .filter(Boolean)
      .join(" ")
      .replace(/(?:password|token|secret|key|jwt|dsn)\s*[:=]\s*\S+/gi, "credential=[REDACTED]");
    throw new Error(`AP1_RPC_${fn.toUpperCase()}_${reason || "ERROR"}`);
  }
  return data as T;
}

function koraInventory(): readonly KoraInventoryRecord[] {
  const golden = goldenJson as KoraProjectBrainGolden;
  return golden.inventory.map((record) => {
    const packageId = GOLDEN_PACKAGE_MAP.get(record.hierarchy.packageId);
    if (!packageId) throw new Error("AP1_KORA_PACKAGE_MAPPING_MISSING");
    return {
      ...record,
      // The sanitized golden keeps the discovered byte size even when an
      // iCloud/object placeholder has no materialized bytes. The accepted DB
      // contract requires all materialization fields to be null until upload.
      sizeBytes: record.availability === "placeholder" ? null : record.sizeBytes,
      hierarchy: {
        ...record.hierarchy,
        projectId: PROJECT_ID,
        packageId,
      },
    };
  });
}

function externalManifest(): ExternalManifest {
  return JSON.parse(readFileSync("tests/fixtures/cycle7/external-package.manifest.json", "utf8")) as ExternalManifest;
}

async function provisionExternalPackage(
  ownerClient: SupabaseClient,
  clientClient: SupabaseClient,
  architectClient: SupabaseClient,
  dbContainer: string,
  users: readonly ExternalUser[],
  projectOwner: ProvisionedUser,
): Promise<void> {
  const manifest = externalManifest();
  const architect = users.find((user) => user.role === "architect")!;
  const builder = users.find((user) => user.role === "builder")!;
  const client = users.find((user) => user.role === "client")!;
  if (manifest.scope.organizationId !== EXTERNAL_ORGANIZATION_ID
    || manifest.scope.projectId !== EXTERNAL_PROJECT_ID
    || manifest.scope.packageId !== EXTERNAL_PACKAGE_ID) {
    throw new Error("AP6_MANIFEST_SCOPE_MISMATCH");
  }

  psql(dbContainer, `
insert into public.designers (id, name, studio_name)
values ('${projectOwner.id}'::uuid, 'AP6 Tashkent Owner', 'ArchiDom AP6')
on conflict (id) do nothing;
insert into public.projects (id, designer_id, client_name, status, intake_token, passport)
values ('${EXTERNAL_PROJECT_ID}'::uuid, '${projectOwner.id}'::uuid,
  'Tashkent Courtyard House', 'active_project', 'ap6-tashkent-external',
  '{"project_name":"Tashkent Courtyard House","object":{"area_m2":340,"city":"Ташкент","type":"house"}}'::jsonb)
on conflict (id) do update set client_name = excluded.client_name, passport = excluded.passport;
`);

  const scope = async (): Promise<number> => {
    const portfolio = await rpc<{ readonly data: readonly { readonly projectId: string; readonly stateRevision: number }[] }>(
      ownerClient, "projectceo_api", "list_projects",
    );
    const current = portfolio.data.find((entry) => entry.projectId === EXTERNAL_PROJECT_ID);
    if (!current) throw new Error("AP6_EXTERNAL_SCOPE_MISSING");
    return current.stateRevision;
  };
  await rpc(ownerClient, "projectceo_api", "enroll_organization_project_scope", {
    project_id: EXTERNAL_PROJECT_ID,
    package_id: EXTERNAL_PACKAGE_ID,
    package_stable_key: "tashkent-external-package",
    package_name: "Ташкентский внешний пакет AP6",
    members: [
      { userId: architect.id, role: "architect" },
      { userId: builder.id, role: "builder" },
      { userId: client.id, role: "client_approver" },
    ],
    idempotency_key: "ap6:tashkent:authenticated-scope-enrollment",
  });

  for (const source of manifest.sources) {
    const suffix = source.fragment.replace("tashkent-fragment-", "");
    const sourceId = `tashkent-source-${suffix}`;
    const sourceRevisionId = `${sourceId}-r1`;
    const nodeId = `tashkent-node-${suffix}`;
    const payload = { sourceId, sourceRevisionId, checksum: source.checksum, sheet: source.sheet };
    const current = await scope();
    const nodes = [{ nodeId, kind: "source", stableKey: `source:${sourceId}`, currentRevisionId: sourceRevisionId }];
    const revisions: Array<Record<string, unknown>> = [{ revisionId: sourceRevisionId, nodeId, revisionNo: 1, title: source.sheet, payload,
      origin: "import", claimStatus: "extracted", unknownReason: null, replacesRevisionId: null,
      contentDigestHex: createHash("sha256").update(JSON.stringify(payload)).digest("hex") }];
    if (source === manifest.sources[0]) {
      nodes.push({ nodeId: EXTERNAL_AREA_NODE_ID, kind: "area", stableKey: "area:tashkent-ground-floor", currentRevisionId: "tashkent-area-r1" });
      const areaPayload = { schemaVersion: "project-ceo/area/0.1", name: "Кухня и гостиная первого этажа" };
      revisions.push({ revisionId: "tashkent-area-r1", nodeId: EXTERNAL_AREA_NODE_ID, revisionNo: 1, title: "Ташкентский первый этаж",
        payload: areaPayload, origin: "human", claimStatus: "human_origin", unknownReason: null, replacesRevisionId: null,
        contentDigestHex: createHash("sha256").update(JSON.stringify(areaPayload)).digest("hex") });
    }
    await rpc(ownerClient, "projectceo_api", "ingest_source_graph", {
      project_id: EXTERNAL_PROJECT_ID,
      source: {
        sourceId, sourceRevisionId, kind: "pdf", checksumHex: source.checksum.slice("sha256:".length),
        packageId: EXTERNAL_PACKAGE_ID,
        metadata: { originalFilename: source.externalRef.split("/").at(-1) ?? source.externalRef, mediaType: "application/pdf", sizeBytes: 1,
          extension: "pdf", sourceRole: "document", declaredRevision: null, documentStatus: "current" },
      },
      fragments: [{ fragmentId: source.fragment, sourceId, locatorKind: "pdf", locator: { kind: "pdf", page: source.page ?? 1 } }],
      nodes, revisions,
      evidence_links: [{ evidenceLinkId: `tashkent-evidence-${suffix}`, nodeRevisionId: sourceRevisionId, sourceFragmentId: source.fragment }],
      edges: [], expected_state_revision: current, idempotency_key: `ap6:tashkent:ingest:${suffix}`,
    });
  }

  const afterIngestion = await scope();
  const published = await rpc<{ readonly result: { readonly version: { readonly id: string } } }>(
    architectClient, "projectceo_api", "publish_source_snapshot", {
      project_id: EXTERNAL_PROJECT_ID, expected_latest_version_id: null,
      expected_state_revision: afterIngestion, label: "Tashkent external source set",
      idempotency_key: "ap6:tashkent:publish-source-set",
    },
  );
  const versionId = published.result.version.id;
  const evidenceFor = (suffix: string) => ({
    evidenceVersionId: versionId,
    evidenceLinkId: `tashkent-evidence-${suffix}`,
    sourceId: `tashkent-source-${suffix}`,
    sourceNodeId: `tashkent-node-${suffix}`,
    sourceRevisionId: `tashkent-source-${suffix}-r1`,
    fragmentId: `tashkent-fragment-${suffix}`,
  });
  const decision = await rpc<{ readonly result: { readonly revisionId: string } }>(
    architectClient, "projectceo_product_api", "append_decision_revision", {
      project_id: EXTERNAL_PROJECT_ID, package_id: EXTERNAL_PACKAGE_ID,
      node_id: EXTERNAL_DESIGN_INTENT_NODE_ID, revision_id: EXTERNAL_DESIGN_INTENT_REVISION_ID,
      expected_revision_id: null, claim_status: "interpreted", title: "Кухня и гостиная первого этажа",
      resolution: "Сформировать три операторских варианта отделки и комплектации для Ташкента.",
      area_node_id: EXTERNAL_AREA_NODE_ID, decision_status: "proposed",
      evidence: [evidenceFor("plan-ground")], reason: "Операторская интерпретация внешнего PDF-пакета.",
      expected_state_revision: await scope(), idempotency_key: "ap6:tashkent:design-intent-r1",
    },
  );
  const selectionSpecs = [
    ["tashkent-selection-floor", "Напольное покрытие", { item: "Floor finish", unit: "m2", amountRub: 1258 }],
    ["tashkent-selection-wall", "Отделка стен", { item: "Wall finish", unit: "m2", amountRub: 986 }],
    ["tashkent-selection-kitchen", "Кухонный комплект", { item: "Kitchen fronts and carcass", unit: "set", amountRub: 125800 }],
  ] as const;
  for (const [nodeId, title, specification] of selectionSpecs) {
    await rpc(architectClient, "projectceo_product_api", "append_selection_revision", {
      project_id: EXTERNAL_PROJECT_ID, package_id: EXTERNAL_PACKAGE_ID, node_id: nodeId,
      revision_id: `${nodeId}-r1`, expected_revision_id: null, claim_status: "interpreted", title,
      area_node_id: EXTERNAL_AREA_NODE_ID, decision_revision_id: decision.result.revisionId,
      specification, evidence: [evidenceFor("plan-ground")], reason: "Операторская подготовка выбора по внешнему пакету.",
      expected_state_revision: await scope(), idempotency_key: `ap6:tashkent:${nodeId}:r1`,
    });
  }
  for (const [nodeId, , specification] of selectionSpecs) {
    await rpc(architectClient, "projectceo_product_api", "append_price_observation", {
      project_id: EXTERNAL_PROJECT_ID, selection_revision_id: `${nodeId}-r1`,
      observation_id: `${nodeId}-price-uzs-rub`, amount_rub: specification.amountRub,
      evidence: evidenceFor("plan-ground"), supplier_ref: "operator-tashkent-worksheet",
      expected_state_revision: await scope(), idempotency_key: `ap6:tashkent:${nodeId}:price-r1`,
    });
  }
  const items = [
    { targetKind: "decision_revision", entityId: EXTERNAL_DESIGN_INTENT_NODE_ID, revisionId: decision.result.revisionId },
    ...selectionSpecs.map(([nodeId]) => ({ targetKind: "selection_revision", entityId: nodeId, revisionId: `${nodeId}-r1` })),
  ];
  const createdApproval = await rpc<{ readonly result: unknown }>(ownerClient, "projectceo_product_api", "create_approval_package", {
    project_id: EXTERNAL_PROJECT_ID, package_id: EXTERNAL_PACKAGE_ID,
    approval_package_id: manifest.m2.approvalPackageId, items,
    expected_state_revision: await scope(), idempotency_key: "ap6:tashkent:create-approval",
  });
  void createdApproval;
  await rpc(ownerClient, "projectceo_product_api", "submit_approval_package", {
    project_id: EXTERNAL_PROJECT_ID, approval_package_id: manifest.m2.approvalPackageId,
    expected_status: "draft", expected_state_revision: await scope(), idempotency_key: "ap6:tashkent:submit-approval",
  });
  const clientScope = await rpc<{ readonly data: readonly { readonly projectId: string; readonly stateRevision: number }[] }>(
    clientClient, "projectceo_api", "list_projects",
  );
  const clientExternal = clientScope.data.find((entry) => entry.projectId === EXTERNAL_PROJECT_ID);
  if (!clientExternal) throw new Error("AP6_CLIENT_EXTERNAL_SCOPE_MISSING");
  await rpc(clientClient, "projectceo_product_api", "review_approval_package", {
    project_id: EXTERNAL_PROJECT_ID, approval_package_id: manifest.m2.approvalPackageId,
    expected_status: "submitted", decision: "approved", reason: "Owner gate: пакет проверен оператором AP6.",
    expected_state_revision: clientExternal.stateRevision, idempotency_key: "ap6:tashkent:review-approval",
  });

}

async function provisionExternalOnly(): Promise<void> {
  const sessionPath = required(process.env.AP1_SESSION_FILE, "SESSION_FILE");
  const dbContainer = required(process.env.AP1_DB_CONTAINER, "DB_CONTAINER");
  const nextOrigin = required(process.env.AP1_NEXT_ORIGIN, "NEXT_ORIGIN");
  const apiUrl = required(process.env.AP1_API_URL, "API_URL");
  const anonKey = required(process.env.AP1_ANON_KEY, "ANON_KEY");
  const serviceRoleKey = required(process.env.AP1_SERVICE_ROLE_KEY, "SERVICE_ROLE_KEY");
  assertLoopback(nextOrigin);
  assertLoopback(apiUrl);

  const session = JSON.parse(readFileSync(sessionPath, "utf8")) as {
    readonly sessions: Record<Ap1Role, { readonly email: string; readonly userId: string }>;
  };
  const users: readonly ExternalUser[] = (Object.keys(session.sessions) as Ap1Role[]).map((role) => ({
    role,
    email: session.sessions[role].email,
    id: session.sessions[role].userId,
  }));
  const admin = createClient(apiUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const externalOwnerPassword = `Ap1!${randomBytes(24).toString("base64url")}9a`;
  const externalOwnerEmail = `ap1-external-owner-${randomBytes(5).toString("hex")}@archidom.invalid`;
  const { data: externalOwnerData, error: externalOwnerError } = await admin.auth.admin.createUser({
    email: externalOwnerEmail,
    password: externalOwnerPassword,
    email_confirm: true,
    user_metadata: { display_name: "AP6 Tashkent Owner" },
  });
  if (externalOwnerError || !externalOwnerData.user) throw new Error("AP1_EXTERNAL_OWNER_CREATE_FAILED");
  const externalOwner: ProvisionedUser = {
    role: "owner", email: externalOwnerEmail, id: externalOwnerData.user.id, password: externalOwnerPassword,
  };

  const authenticate = async (role: Ap1Role): Promise<SupabaseClient> => {
    const user = session.sessions[role];
    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: user.email,
      options: { redirectTo: `${nextOrigin}/auth/callback` },
    });
    if (error || !data.properties.hashed_token) {
      throw new Error(`AP1_EXTERNAL_${role.toUpperCase()}_MAGICLINK_FAILED`);
    }
    const client = createClient(apiUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: verifyError } = await client.auth.verifyOtp({
      token_hash: data.properties.hashed_token,
      type: "magiclink",
    });
    if (verifyError) throw new Error(`AP1_EXTERNAL_${role.toUpperCase()}_SESSION_FAILED`);
    return client;
  };

  const externalOwnerClient = createClient(apiUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: externalOwnerSignInError } = await externalOwnerClient.auth.signInWithPassword({
    email: externalOwner.email,
    password: externalOwner.password,
  });
  if (externalOwnerSignInError) throw new Error("AP1_EXTERNAL_OWNER_SESSION_FAILED");
  await provisionExternalPackage(
    externalOwnerClient,
    await authenticate("client"),
    await authenticate("architect"),
    dbContainer,
    users,
    externalOwner,
  );
  const { data: externalOwnerLink, error: externalOwnerLinkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: externalOwner.email,
    options: { redirectTo: `${nextOrigin}/auth/callback` },
  });
  if (externalOwnerLinkError || !externalOwnerLink.properties.hashed_token) {
    throw new Error("AP1_EXTERNAL_OWNER_MAGICLINK_FAILED");
  }
  const externalOwnerSessionPath = "/private/tmp/projectceo-ap1-external-owner.json";
  writeFileSync(externalOwnerSessionPath, JSON.stringify({
    userId: externalOwner.id,
    tokenHash: externalOwnerLink.properties.hashed_token,
  }));
  chmodSync(externalOwnerSessionPath, 0o600);
  process.stdout.write("AP1_EXTERNAL_PACKAGE_PROVISIONED environment=disposable production_changed=false\n");
}

async function main(): Promise<void> {
  if (process.env.AP1_EXTERNAL_ONLY === "1") {
    await provisionExternalOnly();
    return;
  }
  const sessionPath = required(process.env.AP1_SESSION_FILE, "SESSION_FILE");
  const dbContainer = required(process.env.AP1_DB_CONTAINER, "DB_CONTAINER");
  const nextOrigin = required(process.env.AP1_NEXT_ORIGIN, "NEXT_ORIGIN");
  const sitePhotoPath = required(process.env.AP1_KORA_SITE_PHOTO, "KORA_SITE_PHOTO");
  assertLoopback(nextOrigin);
  const sitePhotoBytes = readFileSync(sitePhotoPath);
  if (sitePhotoBytes.byteLength < 1 || sitePhotoBytes.byteLength > 26_214_400) {
    throw new Error("AP1_KORA_SITE_PHOTO_SIZE_INVALID");
  }

  const status = process.env.AP1_STATUS_FILE
    ? JSON.parse(readFileSync(process.env.AP1_STATUS_FILE, "utf8")) as LocalStatus
    : {};
  const apiUrl = required(
    process.env.AP1_API_URL ?? status.API_URL ?? status.api?.url,
    "API_URL",
  );
  const anonKey = required(
    process.env.AP1_ANON_KEY ?? status.ANON_KEY ?? status.api?.anon_key,
    "ANON_KEY",
  );
  const serviceRoleKey = required(
    process.env.AP1_SERVICE_ROLE_KEY
      ?? status.SERVICE_ROLE_KEY
      ?? status.auth?.service_role_key,
    "SERVICE_ROLE_KEY",
  );
  assertLoopback(apiUrl);

  const admin = createClient(apiUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const roles: readonly Ap1Role[] = ["owner", "architect", "builder", "client", "guest"];
  const runId = randomBytes(5).toString("hex");
  const users: ProvisionedUser[] = [];

  for (const role of roles) {
    const email = `ap1-${role}-${runId}@archidom.invalid`;
    const password = `Ap1!${randomBytes(24).toString("base64url")}9a`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: `AP1 ${role}`, ap1_role: role },
    });
    if (error || !data.user) throw new Error(`AP1_CREATE_USER_${role.toUpperCase()}_FAILED`);
    users.push({ role, email, id: data.user.id, password });
  }

  const owner = users.find((user) => user.role === "owner")!;
  psql(dbContainer, `
begin;

insert into public.designers (id, name, studio_name)
values ('${owner.id}'::uuid, 'Kora Owner', 'ArchiDom Kora')
on conflict (id) do nothing;

insert into public.projects (id, designer_id, client_name, status, intake_token, passport)
values ('${PROJECT_ID}'::uuid, '${owner.id}'::uuid, 'Kora Food Hall', 'active_project', 'ap1-kora-identity',
  '{"project_name":"Kora Food Hall","object":{"area_m2":1800,"city":"Убуд, Бали","type":"commercial"}}'::jsonb)
on conflict (id) do nothing;

update public.projects
set client_name = 'Kora Food Hall',
    passport = jsonb_build_object(
      'project_name', 'Kora Food Hall',
      'object', jsonb_build_object(
        'area_m2', 1800,
        'city', 'Убуд, Бали',
        'type', 'commercial'
      )
    )
where id = '${PROJECT_ID}'::uuid;

insert into projectceo_foundation.project_packages (
  organization_id, project_id, id, stable_key, kind, parent_package_id, name
)
select workflow.organization_id, workflow.project_id, package.id,
       package.stable_key, 'work_package', workflow.project_id, package.name
from project_intelligence.project_workflows workflow
cross join (values
  ('${PACKAGE_IDS.engineering}'::uuid, 'engineering-release', 'Инженерный выпуск'),
  ('${PACKAGE_IDS.controls}'::uuid, 'project-controls-release', 'Управление проектом'),
  ('${PACKAGE_IDS.site}'::uuid, 'site-evidence-release', 'Полевые подтверждения')
) package(id, stable_key, name)
where workflow.project_id = '${PROJECT_ID}'::uuid
on conflict (organization_id, project_id, id) do nothing;

insert into project_intelligence.organization_members (
  organization_id, user_id, role, status
)
select workflow.organization_id, '${owner.id}'::uuid, 'owner', 'active'
from project_intelligence.project_workflows workflow
where workflow.project_id = '${PROJECT_ID}'::uuid
on conflict (organization_id, user_id) do nothing;

insert into projectceo_foundation.project_memberships (
  organization_id, project_id, user_id, role, status
)
select workflow.organization_id, workflow.project_id,
       '${owner.id}'::uuid, 'owner_lead', 'active'
from project_intelligence.project_workflows workflow
where workflow.project_id = '${PROJECT_ID}'::uuid
on conflict (organization_id, project_id, user_id) do nothing;

insert into projectceo_foundation.project_member_capabilities (
  organization_id, project_id, user_id, capability
)
select membership.organization_id, membership.project_id,
       membership.user_id, preset.capability
from projectceo_foundation.project_memberships membership
cross join lateral projectceo_foundation._role_capabilities('owner_lead') preset
where membership.project_id = '${PROJECT_ID}'::uuid
  and membership.user_id = '${owner.id}'::uuid
on conflict do nothing;

commit;
`);

  const ownerClient = createClient(apiUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await ownerClient.auth.signInWithPassword({
    email: owner.email,
    password: owner.password,
  });
  if (signInError) throw new Error("AP1_OWNER_PASSWORD_SESSION_FAILED");
  await rpc(ownerClient, "projectceo_api", "enroll_organization_project", {
    project_id: PROJECT_ID,
    idempotency_key: "ap1:kora:enroll-authenticated-project",
  });

  const portfolio = await rpc<{
    readonly data: readonly { readonly projectId: string; readonly stateRevision: number }[];
  }>(ownerClient, "projectceo_api", "list_projects");
  let scope = portfolio.data.find((entry) => entry.projectId === PROJECT_ID);
  if (!scope) throw new Error("AP1_OWNER_PROJECT_SCOPE_MISSING");
  const packageInviteRawToken = randomBytes(32);
  const packageInviteDigest = `\\x${createHash("sha256").update(packageInviteRawToken).digest("hex")}`;
  await rpc(ownerClient, "projectceo_api", "create_invitation", {
    project_id: PROJECT_ID,
    package_id: ROOT_PACKAGE_ID,
    recipient_email: owner.email,
    role: "architect",
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    token_digest: packageInviteDigest,
    expected_state_revision: scope.stateRevision,
    idempotency_key: "ap1:kora:package-owner-scope-invitation",
  });
  await rpc(ownerClient, "projectceo_api", "accept_invitation", {
    token_digest: packageInviteDigest,
    idempotency_key: "ap1:kora:package-owner-scope-accept",
  }).catch((error: unknown) => {
    // Password sessions cannot satisfy the invitation AMR contract. Acceptance
    // is retried by the owner magic-link session in run-five-sessions.zsh.
    if (!(error instanceof Error) || !error.message.includes("identity_unverified")) throw error;
  });
  const refreshedPackageScope = await rpc<{
    readonly data: readonly { readonly projectId: string; readonly stateRevision: number }[];
  }>(ownerClient, "projectceo_api", "list_projects");
  scope = refreshedPackageScope.data.find((entry) => entry.projectId === PROJECT_ID);
  if (!scope) throw new Error("AP1_OWNER_PACKAGE_SCOPE_REFRESH_MISSING");

  const inventory = koraInventory();
  const importPlan = planSourceImport(inventory);
  if (
    importPlan.summary.physicalRecords !== 209
    || importPlan.summary.materializedRecords !== 81
    || importPlan.summary.placeholders !== 128
    || importPlan.summary.uniqueMaterializedBlobs !== 28
    || importPlan.summary.duplicateGroups !== 18
    || importPlan.summary.semanticConflictGroups !== 8
  ) {
    throw new Error("AP1_KORA_INVENTORY_PROFILE_INVALID");
  }
  const registration = await rpc<{
    readonly result: { readonly registeredPhysicalRecords: number };
  }>(ownerClient, "projectceo_api", "register_source_inventory", {
    project_id: PROJECT_ID,
    records: inventory,
    import_plan: importPlan,
    expected_state_revision: scope.stateRevision,
    idempotency_key: "ap1:kora:register-all-209",
  });
  if (registration.result.registeredPhysicalRecords !== 209) {
    throw new Error("AP1_KORA_INVENTORY_REGISTRATION_INCOMPLETE");
  }

  // Add one genuine Kora construction-progress photo after the exact 209-record
  // drawing/document registry has been verified. Its local absolute path and
  // original filename never enter the database, evidence, or committed files.
  const sitePhotoChecksum = createHash("sha256").update(sitePhotoBytes).digest("hex");
  const photoRecord: KoraInventoryRecord = {
    physicalRecordId: "71111111-1111-4111-8111-111111111111",
    sanitizedName: "source-site-photo-001.jpg",
    hierarchy: {
      projectId: PROJECT_ID,
      packageId: PACKAGE_IDS.architecture,
      floorId: "floor-first_floor",
      zoneId: "zone-food-hall",
      disciplineId: "site-progress",
    },
    availability: "materialized",
    documentStatus: "current",
    mediaKind: "image",
    sizeBytes: sitePhotoBytes.byteLength,
    checksum: sitePhotoChecksum,
    sourceRevisionId: "revision-kora-site-photo-ap1-r1",
    semanticConflict: false,
  };
  const photoSourceId = `source-sha256-${sitePhotoChecksum.slice(0, 24)}`;
  const photoNodeId = `node-${photoSourceId}`;
  const photoPayload = {
    schemaVersion: "project-ceo/source-metadata/0.1",
    sourceId: photoSourceId,
  } as const;
  const afterGoldenInventory = await rpc<{
    readonly data: readonly { readonly projectId: string; readonly stateRevision: number }[];
  }>(ownerClient, "projectceo_api", "list_projects");
  const afterGoldenScope = afterGoldenInventory.data.find((entry) => entry.projectId === PROJECT_ID);
  if (!afterGoldenScope) throw new Error("AP1_OWNER_POST_GOLDEN_SCOPE_MISSING");
  const uploadAuthorization = await rpc<{
    readonly data: { readonly bucket: string; readonly objectKey: string };
  }>(ownerClient, "projectceo_api", "authorize_source_upload", {
    project_id: PROJECT_ID,
    package_id: PACKAGE_IDS.architecture,
    checksum_hex: sitePhotoChecksum,
    media_type: "image/jpeg",
    extension: "jpg",
    size_bytes: sitePhotoBytes.byteLength,
    source_role: "photo-evidence",
  });
  if (uploadAuthorization.data.bucket !== "client-uploads") {
    throw new Error("AP1_KORA_SITE_PHOTO_BUCKET_INVALID");
  }
  const { error: photoUploadError } = await admin.storage
    .from(uploadAuthorization.data.bucket)
    .upload(uploadAuthorization.data.objectKey, sitePhotoBytes, {
      contentType: "image/jpeg",
      upsert: false,
    });
  if (photoUploadError) throw new Error("AP1_KORA_SITE_PHOTO_UPLOAD_FAILED");

  const photoPlan = planSourceImport([photoRecord]);
  const photoRegistration = await rpc<{
    readonly result: { readonly registeredPhysicalRecords: number };
  }>(ownerClient, "projectceo_api", "register_source_inventory", {
    project_id: PROJECT_ID,
    records: [photoRecord],
    import_plan: photoPlan,
    expected_state_revision: afterGoldenScope.stateRevision,
    idempotency_key: "ap1:kora:register-site-photo",
  });
  if (photoRegistration.result.registeredPhysicalRecords !== 1) {
    throw new Error("AP1_KORA_SITE_PHOTO_REGISTRATION_FAILED");
  }
  const afterInventory = await rpc<{
    readonly data: readonly { readonly projectId: string; readonly stateRevision: number }[];
  }>(ownerClient, "projectceo_api", "list_projects");
  const afterInventoryScope = afterInventory.data.find((entry) => entry.projectId === PROJECT_ID);
  if (!afterInventoryScope) throw new Error("AP1_OWNER_POST_INVENTORY_SCOPE_MISSING");
  await rpc(ownerClient, "projectceo_api", "ingest_source_graph", {
    project_id: PROJECT_ID,
    source: {
      sourceId: photoSourceId,
      sourceRevisionId: photoRecord.sourceRevisionId,
      kind: "image",
      checksumHex: sitePhotoChecksum,
      packageId: PACKAGE_IDS.architecture,
      metadata: {
        originalFilename: photoRecord.sanitizedName,
        mediaType: "image/jpeg",
        sizeBytes: photoRecord.sizeBytes,
        extension: "jpg",
        sourceRole: "photo-evidence",
        declaredRevision: null,
        documentStatus: photoRecord.documentStatus,
      },
    },
    fragments: [],
    nodes: [{
      nodeId: photoNodeId,
      kind: "source",
      stableKey: `source:${photoSourceId}`,
      currentRevisionId: photoRecord.sourceRevisionId,
    }, {
      nodeId: KORA_AREA_NODE_ID,
      kind: "area",
      stableKey: "area:kora-site-progress",
      currentRevisionId: KORA_AREA_REVISION_ID,
    }],
    revisions: [{
      revisionId: photoRecord.sourceRevisionId,
      nodeId: photoNodeId,
      revisionNo: 1,
      title: photoRecord.sanitizedName,
      payload: photoPayload,
      origin: "import",
      claimStatus: "extracted",
      unknownReason: null,
      replacesRevisionId: null,
      contentDigestHex: createHash("sha256")
        .update(JSON.stringify(photoPayload))
        .digest("hex"),
    }, {
      revisionId: KORA_AREA_REVISION_ID,
      nodeId: KORA_AREA_NODE_ID,
      revisionNo: 1,
      title: "Kora construction site progress area",
      payload: { schemaVersion: "project-ceo/area/0.1", name: "Kora Food Hall construction area" },
      origin: "import",
      claimStatus: "extracted",
      unknownReason: null,
      replacesRevisionId: null,
      contentDigestHex: createHash("sha256")
        .update(JSON.stringify({ schemaVersion: "project-ceo/area/0.1", name: "Kora Food Hall construction area" }))
        .digest("hex"),
    }],
    evidence_links: [],
    edges: [],
    expected_state_revision: afterInventoryScope.stateRevision,
    idempotency_key: "ap1:kora:ingest-site-photo",
  });

  const read = await rpc<{
    readonly data: {
      readonly projectMetadata: { readonly areaM2: number; readonly name: string };
      readonly sourceStats: {
        readonly duplicateGroups: number;
        readonly physicalRecords: number;
        readonly materializedRecords: number;
        readonly placeholders: number;
        readonly quarantinedGroups: number;
        readonly uniqueBlobs: number;
      };
    };
  }>(ownerClient, "projectceo_read_api", "get_project_workspace_read", {
    project_id: PROJECT_ID,
    package_id: null,
  });
  if (
    read.data.projectMetadata.name !== "Kora Food Hall"
    || read.data.projectMetadata.areaM2 !== 1800
    || read.data.sourceStats.physicalRecords !== 210
    || read.data.sourceStats.materializedRecords !== 82
    || read.data.sourceStats.placeholders !== 128
    || read.data.sourceStats.uniqueBlobs !== 29
    || read.data.sourceStats.duplicateGroups !== 18
    || read.data.sourceStats.quarantinedGroups !== 8
  ) {
    throw new Error("AP1_KORA_AUTHENTICATED_READ_MISMATCH");
  }

  const refreshedPortfolio = await rpc<{
    readonly data: readonly { readonly projectId: string; readonly stateRevision: number }[];
  }>(ownerClient, "projectceo_api", "list_projects");
  const refreshedScope = refreshedPortfolio.data.find((entry) => entry.projectId === PROJECT_ID);
  if (!refreshedScope) throw new Error("AP1_OWNER_REFRESHED_SCOPE_MISSING");
  const guest = users.find((user) => user.role === "guest")!;
  const guestClient = createClient(apiUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: guestSignInError } = await guestClient.auth.signInWithPassword({
    email: guest.email,
    password: guest.password,
  });
  if (guestSignInError) throw new Error("AP1_GUEST_PASSWORD_SESSION_FAILED");
  const guestPortfolio = await rpc<{ readonly data: readonly unknown[] }>(
    guestClient,
    "projectceo_api",
    "list_projects",
  );
  if (guestPortfolio.data.length !== 0) throw new Error("AP1_UNGRANTED_USER_LEAK");

  const browserSessions: Record<Ap1Role, {
    readonly email: string;
    readonly tokenHash: string;
    readonly userId: string;
  }> = {} as Record<Ap1Role, {
    readonly email: string;
    readonly tokenHash: string;
    readonly userId: string;
  }>;
  for (const user of users) {
    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: user.email,
      options: { redirectTo: `${nextOrigin}/auth/callback` },
    });
    if (error || !data.properties.hashed_token) {
      throw new Error(`AP1_MAGICLINK_${user.role.toUpperCase()}_FAILED`);
    }
    browserSessions[user.role] = {
      email: user.email,
      tokenHash: data.properties.hashed_token,
      userId: user.id,
    };
  }

  writeFileSync(sessionPath, JSON.stringify({
    contractVersion: "archidom-ap1-sessions/0.1",
    projectId: PROJECT_ID,
    rootPackageId: ROOT_PACKAGE_ID,
    architecturePackageId: PACKAGE_IDS.architecture,
    architectureReleaseVersionId: null,
    releaseVersionId: null,
    packageInviteToken: packageInviteRawToken.toString("base64url"),
    photoSourceId,
    photoSourceRevisionId: photoRecord.sourceRevisionId,
    photoChecksum: sitePhotoChecksum,
    guestToken: null,
    guestReleaseVersionId: null,
    areaNodeId: KORA_AREA_NODE_ID,
    guestTokenScopeVerified: false,
    sessions: browserSessions,
  }));
  chmodSync(sessionPath, 0o600);
  process.stdout.write(
    "AP1_KORA_PROVISIONED users=5 registry=209 foundation_fixtures=4 site_photos=1 physical=210 materialized=82 placeholders=128 area_m2=1800 production_changed=false\n",
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "AP1_KORA_PROVISION_FAILED";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
