import type {
  FoundationEnvelope,
  PostgresBytea,
  PostgresRpcClient,
} from "./contracts";
import {
  parseCommandMutation,
  parseFoundationEnvelope,
  type CommandMutation,
} from "./contracts";
import { callRpc } from "./rpc";

export interface EnrollmentResult {
  readonly organizationId: string;
  readonly projectId: string;
  readonly rootPackageId: string;
  readonly ownerUserId: string;
}

export interface InvitationResult {
  readonly invitationId: string;
  readonly projectId: string;
  readonly packageId: string | null;
  readonly scope: "project" | "package";
  readonly role: string;
  readonly expiresAt: string;
}

export interface AcceptedInvitationResult {
  readonly invitationId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly packageId: string | null;
  readonly scope: "project" | "package";
  readonly role: string;
  readonly userId: string;
}

export interface GuestGrantResult {
  readonly grantId: string;
  readonly projectId: string;
  readonly packageId: string;
  readonly versionId: string;
  readonly expiresAt: string;
  readonly allowAcknowledgement: boolean;
}

export interface SourceUploadAuthorization {
  readonly bucket: "client-uploads";
  readonly objectKey: string;
  readonly upsert: false;
  readonly checksum: string;
  readonly mediaType: string;
  readonly organizationId?: string;
  readonly projectId: string;
  readonly packageId: string;
}

export interface SourceDownloadAuthorization {
  readonly bucket: "client-uploads";
  readonly objectKey: string;
  readonly ttlSeconds: number;
  readonly projectId: string;
  readonly packageId: string;
  readonly sourceId: string;
}

export interface ProjectListItem {
  readonly accessScope: "project" | "package";
  readonly organizationId: string;
  readonly projectId: string;
  readonly packageId?: string;
  readonly role: "owner_lead" | "architect" | "builder" | "client_approver";
  readonly stateRevision: number;
}

export interface ProjectDeliveryProjection {
  readonly projectId: string;
  readonly packageId: string | null;
  readonly latestBaseline: unknown | null;
  readonly packageVersions: readonly unknown[];
  readonly releaseArtifacts: readonly unknown[];
  readonly extensionStatus?: Readonly<Record<string, string>>;
}

export class FoundationPostgresAdapter {
  constructor(private readonly client: PostgresRpcClient) {}

  /**
   * Решение по источнику. Идёт через тонкую дверь `projectceo_api.review_source`
   * (миграция 20260810050000), а не напрямую в `project_intelligence_api`:
   * та схема не отдана Data API, и прямой вызов из приложения не находится
   * PostgREST. Дверь ничего не расширяет — `security invoker`, авторизация
   * остаётся во внутренней `review_claim`.
   */
  async reviewSource(input: {
    readonly projectId: string;
    readonly targetRevisionId: string;
    readonly expectedRevisionId: string;
    readonly expectedStateRevision: number;
    readonly decision: "confirmed" | "rejected";
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<unknown>> {
    return parseCommandMutation<unknown>(
      await callRpc(this.client, "projectceo_api", "review_source", {
        project_id: input.projectId,
        target_revision_id: input.targetRevisionId,
        expected_revision_id: input.expectedRevisionId,
        expected_state_revision: input.expectedStateRevision,
        decision: input.decision,
        idempotency_key: input.idempotencyKey,
      }),
    );
  }

  /**
   * Дверь публикации версии графа (`20260810080000`).
   *
   * Версия — предпосылка baseline: `publish_project_baseline` требует строку
   * `project_intelligence.project_versions`. Сама операция живёт в приватной
   * `project_intelligence_api`, не отданной Data API, поэтому вызов идёт через
   * делегирующую функцию в `projectceo_api`. Прав она не добавляет.
   */
  async publishVersion(input: {
    readonly projectId: string;
    readonly expectedLatestVersionId: string | null;
    readonly expectedStateRevision: number;
    readonly label: string;
    readonly selectedRevisions: readonly unknown[];
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<unknown>> {
    return parseCommandMutation<unknown>(
      await callRpc(this.client, "projectceo_api", "publish_version", {
        project_id: input.projectId,
        expected_latest_version_id: input.expectedLatestVersionId,
        expected_state_revision: input.expectedStateRevision,
        label: input.label,
        selected_revisions: input.selectedRevisions,
        idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async enrollOrganizationProject(input: {
    readonly projectId: string;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<EnrollmentResult>> {
    return parseCommandMutation<EnrollmentResult>(
      await callRpc(this.client, "projectceo_api", "enroll_organization_project", {
        project_id: input.projectId,
        idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async createInvitation(input: {
    readonly projectId: string;
    readonly packageId: string | null;
    readonly recipientEmail: string;
    readonly role: string;
    readonly expiresAt: string;
    readonly tokenDigest: PostgresBytea;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<InvitationResult>> {
    return parseCommandMutation<InvitationResult>(
      await callRpc(this.client, "projectceo_api", "create_invitation", {
        project_id: input.projectId,
        package_id: input.packageId,
        recipient_email: input.recipientEmail,
        role: input.role,
        expires_at: input.expiresAt,
        token_digest: input.tokenDigest,
        expected_state_revision: input.expectedStateRevision,
        idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async acceptInvitation(input: {
    readonly tokenDigest: PostgresBytea;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<AcceptedInvitationResult>> {
    return parseCommandMutation<AcceptedInvitationResult>(
      await callRpc(this.client, "projectceo_api", "accept_invitation", {
        token_digest: input.tokenDigest,
        idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async revokeInvitation(input: {
    readonly projectId: string;
    readonly invitationId: string;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<{ readonly invitationId: string; readonly revoked: true }>> {
    return parseCommandMutation(
      await callRpc(this.client, "projectceo_api", "revoke_invitation", {
        project_id: input.projectId,
        invitation_id: input.invitationId,
        expected_state_revision: input.expectedStateRevision,
        idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async createGuestGrant(input: {
    readonly projectId: string;
    readonly packageId: string;
    readonly versionId: string;
    readonly allowAcknowledgement: boolean;
    readonly expiresAt: string;
    readonly tokenDigest: PostgresBytea;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<GuestGrantResult>> {
    return parseCommandMutation<GuestGrantResult>(
      await callRpc(this.client, "projectceo_api", "create_guest_access_grant", {
        project_id: input.projectId,
        package_id: input.packageId,
        version_id: input.versionId,
        allow_acknowledgement: input.allowAcknowledgement,
        expires_at: input.expiresAt,
        token_digest: input.tokenDigest,
        expected_state_revision: input.expectedStateRevision,
        idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async revokeGuestGrant(input: {
    readonly projectId: string;
    readonly grantId: string;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<{ readonly grantId: string; readonly revoked: true }>> {
    return parseCommandMutation(
      await callRpc(this.client, "projectceo_api", "revoke_guest_access_grant", {
        project_id: input.projectId,
        grant_id: input.grantId,
        expected_state_revision: input.expectedStateRevision,
        idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async authorizeSourceUpload(input: {
    readonly projectId: string;
    readonly packageId: string;
    readonly checksumHex: string;
    readonly mediaType: string;
    readonly extension: string;
    readonly sizeBytes: number;
    readonly sourceRole: string;
  }): Promise<FoundationEnvelope<SourceUploadAuthorization>> {
    return parseFoundationEnvelope<SourceUploadAuthorization>(
      await callRpc(this.client, "projectceo_api", "authorize_source_upload", {
        project_id: input.projectId,
        package_id: input.packageId,
        checksum_hex: input.checksumHex,
        media_type: input.mediaType,
        extension: input.extension,
        size_bytes: input.sizeBytes,
        source_role: input.sourceRole,
      }),
    );
  }

  async authorizeSourceDownload(input: {
    readonly projectId: string;
    readonly sourceId: string;
    readonly ttlSeconds: number;
  }): Promise<FoundationEnvelope<SourceDownloadAuthorization>> {
    return parseFoundationEnvelope<SourceDownloadAuthorization>(
      await callRpc(this.client, "projectceo_api", "authorize_source_download", {
        project_id: input.projectId,
        source_id: input.sourceId,
        ttl_seconds: input.ttlSeconds,
      }),
    );
  }

  async registerSourceInventory(input: {
    readonly projectId: string;
    readonly records: readonly unknown[];
    readonly importPlan: unknown;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<{ readonly registeredPhysicalRecords: number }>> {
    return parseCommandMutation(
      await callRpc(this.client, "projectceo_api", "register_source_inventory", {
        project_id: input.projectId,
        records: input.records,
        import_plan: input.importPlan,
        expected_state_revision: input.expectedStateRevision,
        idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async ingestSourceGraph(input: {
    readonly projectId: string;
    readonly source: unknown;
    readonly fragments: readonly unknown[];
    readonly nodes: readonly unknown[];
    readonly revisions: readonly unknown[];
    readonly evidenceLinks: readonly unknown[];
    readonly edges: readonly unknown[];
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<
    CommandMutation<{
      readonly ingestionId: string;
      readonly packageId: string;
      readonly sourceId: string;
      readonly sourceRevisionId: string;
    }>
  > {
    return parseCommandMutation(
      await callRpc(this.client, "projectceo_api", "ingest_source_graph", {
        project_id: input.projectId,
        source: input.source,
        fragments: input.fragments,
        nodes: input.nodes,
        revisions: input.revisions,
        evidence_links: input.evidenceLinks,
        edges: input.edges,
        expected_state_revision: input.expectedStateRevision,
        idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async listProjects(): Promise<FoundationEnvelope<readonly ProjectListItem[]>> {
    return parseFoundationEnvelope(
      await callRpc(this.client, "projectceo_api", "list_projects"),
    );
  }

  async getProjectSummary(
    projectId: string,
  ): Promise<FoundationEnvelope<Readonly<Record<string, unknown>>>> {
    return parseFoundationEnvelope(
      await callRpc(this.client, "projectceo_api", "get_project_summary", {
        project_id: projectId,
      }),
    );
  }

  async listProjectAccess(
    projectId: string,
  ): Promise<FoundationEnvelope<Readonly<Record<string, unknown>>>> {
    return parseFoundationEnvelope(
      await callRpc(this.client, "projectceo_api", "list_project_access", {
        project_id: projectId,
      }),
    );
  }

  async listProjectSources(
    projectId: string,
  ): Promise<FoundationEnvelope<readonly Readonly<Record<string, unknown>>[]>> {
    return parseFoundationEnvelope(
      await callRpc(this.client, "projectceo_api", "list_project_sources", {
        project_id: projectId,
      }),
    );
  }

  async getReviewQueue(
    projectId: string,
  ): Promise<FoundationEnvelope<readonly Readonly<Record<string, unknown>>[]>> {
    return parseFoundationEnvelope(
      await callRpc(this.client, "projectceo_api", "get_review_queue", {
        project_id: projectId,
      }),
    );
  }

  async getProjectDelivery(input: {
    readonly projectId: string;
    readonly packageId: string | null;
  }): Promise<FoundationEnvelope<ProjectDeliveryProjection>> {
    return parseFoundationEnvelope(
      await callRpc(this.client, "projectceo_api", "get_project_delivery", {
        project_id: input.projectId,
        package_id: input.packageId,
      }),
    );
  }

  async getAuditTimeline(
    projectId: string,
  ): Promise<FoundationEnvelope<readonly Readonly<Record<string, unknown>>[]>> {
    return parseFoundationEnvelope(
      await callRpc(this.client, "projectceo_api", "get_audit_timeline", {
        project_id: projectId,
      }),
    );
  }

  async readGuestRelease(
    tokenDigest: PostgresBytea,
  ): Promise<FoundationEnvelope<ProjectDeliveryProjection>> {
    return parseFoundationEnvelope(
      await callRpc(this.client, "projectceo_api", "read_guest_release", {
        token_digest: tokenDigest,
      }),
    );
  }
}

/** Service-role maintenance surface. It cannot perform human approvals. */
export class FoundationMaintenancePostgresAdapter {
  constructor(private readonly client: PostgresRpcClient) {}

  async expireInvitation(input: {
    readonly projectId: string;
    readonly invitationId: string;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<{ readonly invitationId: string; readonly expired: true }>> {
    return parseCommandMutation(
      await callRpc(this.client, "projectceo_api", "expire_invitation", {
        project_id: input.projectId,
        invitation_id: input.invitationId,
        expected_state_revision: input.expectedStateRevision,
        idempotency_key: input.idempotencyKey,
      }),
    );
  }
}
