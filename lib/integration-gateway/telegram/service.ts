import { z } from "zod";
import { callRpc } from "@/lib/project-intelligence/adapters/postgres/rpc";
import type { PostgresRpcClient } from "@/lib/project-intelligence/adapters/postgres/contracts";

const telegramCandidateSchema = z.object({
  candidateId: z.string().uuid(),
  sourceKind: z.enum(["message", "attachment"]),
  status: z.enum(["candidate", "accepted", "rejected"]),
  attachmentId: z.string().uuid().nullable(),
  displayName: z.string().nullable(),
  mediaType: z.string().nullable(),
  sizeBytes: z.number().int().positive().nullable(),
  createdAt: z.string(),
  reviewedAt: z.string().nullable(),
  reviewReason: z.string().nullable(),
  clientProjection: z.boolean(),
});

export type TelegramCandidateProjection = z.infer<typeof telegramCandidateSchema>;

const commandResultSchema = z.object({
  operation: z.string().min(1),
  replay: z.boolean(),
  result: z.record(z.string(), z.unknown()),
});

export class TelegramBridgeService {
  constructor(private readonly client: PostgresRpcClient) {}

  async listCandidates(projectId: string): Promise<TelegramCandidateProjection[]> {
    return z.array(telegramCandidateSchema).parse(
      await callRpc(this.client, "remhaos_integration_api", "list_telegram_candidates", {
        p_project_id: projectId,
      }),
    );
  }

  async reviewCandidate(input: {
    readonly projectId: string;
    readonly candidateId: string;
    readonly decision: "accepted" | "rejected";
    readonly reason: string;
    readonly idempotencyKey: string;
  }) {
    return commandResultSchema.parse(
      await callRpc(this.client, "remhaos_integration_api", "review_telegram_candidate", {
        p_project_id: input.projectId,
        p_candidate_id: input.candidateId,
        p_decision: input.decision,
        p_reason: input.reason,
        p_idempotency_key: input.idempotencyKey,
      }),
    );
  }
}
