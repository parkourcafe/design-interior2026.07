import { z } from "zod";
import { callRpc } from "@/lib/project-intelligence/adapters/postgres/rpc";
import type { PostgresRpcClient } from "@/lib/project-intelligence/adapters/postgres/contracts";
import {
  normalizeProjectLinkUrl,
  projectLinkCategorySchema,
} from "../core/url-policy";

const projectLinkProjectionSchema = z.object({
  linkId: z.string().uuid(),
  category: projectLinkCategorySchema,
  domain: z.string().min(1),
  title: z.string().min(1),
  tags: z.array(z.string()),
  visibility: z.enum(["internal", "candidate", "published_to_client"]),
  currentRevisionNo: z.number().int().positive(),
  publishedRevisionNo: z.number().int().positive().nullable(),
  revisionNo: z.number().int().positive(),
  normalizedUrl: z.string().url(),
  note: z.string().nullable(),
  capturedAt: z.string(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  publishedAt: z.string().nullable(),
  clientProjection: z.boolean(),
});

const commandResultSchema = z.object({
  operation: z.string().min(1),
  replay: z.boolean(),
  result: z.record(z.unknown()),
});

const projectLinkAccessSchema = z.object({
  clientProjection: z.boolean(),
  canContribute: z.boolean(),
  canPublish: z.boolean(),
});

export type ProjectLinkProjection = z.infer<typeof projectLinkProjectionSchema>;
export type ProjectLinkAccess = z.infer<typeof projectLinkAccessSchema>;

export class ProjectLinkService {
  constructor(private readonly client: PostgresRpcClient) {}

  async list(projectId: string): Promise<ProjectLinkProjection[]> {
    return z.array(projectLinkProjectionSchema).parse(
      await callRpc(this.client, "remhaos_integration_api", "list_project_links", {
        p_project_id: projectId,
      }),
    );
  }

  async access(projectId: string): Promise<ProjectLinkAccess> {
    return projectLinkAccessSchema.parse(
      await callRpc(
        this.client,
        "remhaos_integration_api",
        "get_project_link_access",
        { p_project_id: projectId },
      ),
    );
  }

  async create(input: {
    readonly projectId: string;
    readonly category: z.infer<typeof projectLinkCategorySchema>;
    readonly title: string;
    readonly url: string;
    readonly tags: readonly string[];
    readonly note: string | null;
    readonly idempotencyKey: string;
  }) {
    const normalized = normalizeProjectLinkUrl(input.url);
    return commandResultSchema.parse(
      await callRpc(this.client, "remhaos_integration_api", "create_project_link", {
        p_project_id: input.projectId,
        p_category: input.category,
        p_title: input.title.trim(),
        p_url: normalized.normalizedUrl,
        p_tags: input.tags,
        p_note: input.note?.trim() || null,
        p_idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async revise(input: {
    readonly projectId: string;
    readonly linkId: string;
    readonly url: string;
    readonly tags: readonly string[];
    readonly note: string | null;
    readonly reason: string | null;
    readonly idempotencyKey: string;
  }) {
    const normalized = normalizeProjectLinkUrl(input.url);
    return commandResultSchema.parse(
      await callRpc(this.client, "remhaos_integration_api", "revise_project_link", {
        p_project_id: input.projectId,
        p_link_id: input.linkId,
        p_url: normalized.normalizedUrl,
        p_tags: input.tags,
        p_note: input.note?.trim() || null,
        p_reason: input.reason?.trim() || null,
        p_idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async archive(input: {
    readonly projectId: string;
    readonly linkId: string;
    readonly reason: string;
    readonly idempotencyKey: string;
  }) {
    return commandResultSchema.parse(
      await callRpc(this.client, "remhaos_integration_api", "archive_project_link", {
        p_project_id: input.projectId,
        p_link_id: input.linkId,
        p_reason: input.reason,
        p_idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async publish(input: {
    readonly projectId: string;
    readonly linkId: string;
    readonly revisionNo: number;
    readonly idempotencyKey: string;
  }) {
    return commandResultSchema.parse(
      await callRpc(
        this.client,
        "remhaos_integration_api",
        "publish_project_link_to_client",
        {
          p_project_id: input.projectId,
          p_link_id: input.linkId,
          p_revision_no: input.revisionNo,
          p_idempotency_key: input.idempotencyKey,
        },
      ),
    );
  }
}
