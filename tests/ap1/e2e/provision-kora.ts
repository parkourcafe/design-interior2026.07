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
  architecture: "49999999-9999-4999-8999-999999999999",
  engineering: "49999999-9999-4999-8999-999999999998",
  controls: "49999999-9999-4999-8999-999999999997",
  site: "49999999-9999-4999-8999-999999999996",
} as const;

const GOLDEN_PACKAGE_MAP = new Map<string, string>([
  ["33333333-3333-4333-8333-333333333333", ROOT_PACKAGE_ID],
  ["44444444-4444-4444-8444-444444444441", PACKAGE_IDS.architecture],
  ["44444444-4444-4444-8444-444444444442", PACKAGE_IDS.engineering],
  ["44444444-4444-4444-8444-444444444443", PACKAGE_IDS.controls],
  ["44444444-4444-4444-8444-444444444444", PACKAGE_IDS.site],
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
  if (error) throw new Error(`AP1_RPC_${fn.toUpperCase()}_${error.code ?? "ERROR"}`);
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

async function main(): Promise<void> {
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

  const portfolio = await rpc<{
    readonly data: readonly { readonly projectId: string; readonly stateRevision: number }[];
  }>(ownerClient, "projectceo_api", "list_projects");
  const scope = portfolio.data.find((entry) => entry.projectId === PROJECT_ID);
  if (!scope) throw new Error("AP1_OWNER_PROJECT_SCOPE_MISSING");

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
    || read.data.sourceStats.physicalRecords !== 214
    || read.data.sourceStats.materializedRecords !== 85
    || read.data.sourceStats.placeholders !== 129
    || read.data.sourceStats.uniqueBlobs !== 32
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
  const projectSummary = await rpc<{
    readonly data: { readonly latestVersionId: string };
  }>(ownerClient, "projectceo_api", "get_project_summary", { project_id: PROJECT_ID });
  if (!projectSummary.data.latestVersionId) throw new Error("AP1_GUEST_GRAPH_VERSION_MISSING");
  const guestRawToken = randomBytes(32);
  const guestToken = guestRawToken.toString("base64url");
  const guestDigest = `\\x${createHash("sha256").update(guestRawToken).digest("hex")}`;
  await rpc(ownerClient, "projectceo_api", "create_guest_access_grant", {
    project_id: PROJECT_ID,
    package_id: ROOT_PACKAGE_ID,
    version_id: projectSummary.data.latestVersionId,
    allow_acknowledgement: false,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    token_digest: guestDigest,
    expected_state_revision: refreshedScope.stateRevision,
    idempotency_key: "ap1:kora:create-scoped-guest",
  });
  const anonClient = createClient(apiUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const guestRelease = await rpc<{
    readonly data: {
      readonly package: { readonly id: string };
      readonly projectId: string;
      readonly release: { readonly versionId: string };
    };
  }>(anonClient, "projectceo_api", "read_guest_release", {
    token_digest: guestDigest,
  });
  if (
    guestRelease.data.projectId !== PROJECT_ID
    || guestRelease.data.package.id !== ROOT_PACKAGE_ID
    || guestRelease.data.release.versionId !== projectSummary.data.latestVersionId
  ) {
    throw new Error("AP1_GUEST_EXACT_SCOPE_MISMATCH");
  }

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
    releaseVersionId: "package-db4-root-v1",
    photoSourceId,
    photoSourceRevisionId: photoRecord.sourceRevisionId,
    guestToken,
    guestReleaseVersionId: projectSummary.data.latestVersionId,
    guestTokenScopeVerified: true,
    sessions: browserSessions,
  }));
  chmodSync(sessionPath, 0o600);
  process.stdout.write(
    "AP1_KORA_PROVISIONED users=5 registry=209 foundation_fixtures=4 site_photos=1 physical=214 materialized=85 placeholders=129 area_m2=1800 production_changed=false\n",
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "AP1_KORA_PROVISION_FAILED";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
