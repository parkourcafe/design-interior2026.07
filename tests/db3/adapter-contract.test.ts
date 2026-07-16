import { describe, expect, it } from "vitest";
import {
  Db2HumanPostgresAdapter,
  Db2WorkerPostgresAdapter,
  FoundationPostgresAdapter,
  type PostgresRpcClient,
} from "../../lib/project-intelligence/adapters/postgres";

function clientReturning(
  data: unknown,
  calls: Array<{
    schema: string;
    functionName: string;
    args: Readonly<Record<string, unknown>> | undefined;
  }>,
): PostgresRpcClient {
  return {
    schema(schema) {
      return {
        rpc(functionName, args) {
          calls.push({ schema, functionName, args });
          return Promise.resolve({ data, error: null });
        },
      };
    },
  };
}

describe("typed postgres adapter boundary", () => {
  it("maps Foundation enrollment to the exact callable schema and signature", async () => {
    const calls: Parameters<typeof clientReturning>[1] = [];
    const adapter = new FoundationPostgresAdapter(
      clientReturning(
        {
          operation: "enroll_organization_project",
          replay: false,
          stateRevision: 1,
          result: {
            organizationId: "org",
            projectId: "project",
            rootPackageId: "package",
            ownerUserId: "user",
          },
        },
        calls,
      ),
    );

    await adapter.enrollOrganizationProject({
      projectId: "project",
      idempotencyKey: "enroll-1",
    });

    expect(calls).toEqual([
      {
        schema: "projectceo_api",
        functionName: "enroll_organization_project",
        args: {
          project_id: "project",
          idempotency_key: "enroll-1",
        },
      },
    ]);
  });

  it("keeps human and worker DB2 operations on disjoint adapters", () => {
    const client = clientReturning(null, []);
    const human = new Db2HumanPostgresAdapter(client);
    const worker = new Db2WorkerPostgresAdapter(client);

    expect("reviewClaim" in human).toBe(true);
    expect("publishVersion" in human).toBe(true);
    expect("reviewImpact" in human).toBe(true);
    expect("calculateImpact" in human).toBe(false);
    expect("buildHandoff" in human).toBe(false);

    expect("calculateImpact" in worker).toBe(true);
    expect("buildHandoff" in worker).toBe(true);
    expect("reviewClaim" in worker).toBe(false);
    expect("reviewImpact" in worker).toBe(false);
  });

  it("does not expose raw database error messages", async () => {
    const client: PostgresRpcClient = {
      schema() {
        return {
          rpc() {
            return Promise.resolve({
              data: null,
              error: {
                code: "P1108",
                message: "IDEMPOTENCY_CONFLICT secret SQL context",
              },
            });
          },
        };
      },
    };

    await expect(
      new FoundationPostgresAdapter(client).enrollOrganizationProject({
        projectId: "project",
        idempotencyKey: "same-key",
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "idempotency_conflict",
        message: "project_ceo.idempotency_conflict",
      }),
    );
  });
});
