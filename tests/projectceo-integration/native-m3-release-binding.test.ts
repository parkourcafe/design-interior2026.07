import { describe, expect, it, vi } from "vitest";
import { ProjectBrainHumanPostgresAdapter } from "../../lib/project-intelligence/adapters/postgres/project-brain";

const input = {
  projectId: "91000000-0000-4000-8000-000000000001",
  packageId: "91000000-0000-4000-8000-000000000002",
  expectedBaselineId: "baseline-1", expectedPreviousVersionId: null,
  expectedStateRevision: 17, commandRef: "native-release-1", idempotencyKey: "native-key-1",
};
describe("native M3 child release adapter (synthetic transport)", () => {
  it.each([false, true])("uses the child-only request-bound door, replay=%s", async replay => {
    const envelope = {operation:"publish_work_package_release_request_bound",replay,stateRevision:18,result:{id:"release:native-release-1"}};
    const rpc = vi.fn(async () => ({data:envelope,error:null}));
    const schema = vi.fn(() => ({rpc}));
    const adapter = new ProjectBrainHumanPostgresAdapter({schema});
    expect(await adapter.publishWorkPackageReleaseRequestBound(input)).toEqual(envelope);
    expect(schema).toHaveBeenCalledWith("projectceo_product_api");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("publish_work_package_release_request_bound", {
      project_id:input.projectId,package_id:input.packageId,expected_baseline_id:input.expectedBaselineId,
      expected_previous_version_id:null,expected_state_revision:17,command_ref:input.commandRef,idempotency_key:input.idempotencyKey,
    });
  });
  it("rejects root instead of selecting an alternative publication RPC", async () => {
    const rpc = vi.fn(); const adapter = new ProjectBrainHumanPostgresAdapter({schema:()=>({rpc})});
    await expect(adapter.publishWorkPackageReleaseRequestBound({...input,packageId:input.projectId})).rejects.toThrow("native_m3_work_package_required");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("preserves a database completeness refusal without any root fallback", async () => {
    const rpc = vi.fn(async () => ({data:null,error:{code:"P1111",message:"validation_failed",details:'{"reason":"NATIVE_M3_CONTEXT_INCOMPLETE"}'}}));
    const adapter = new ProjectBrainHumanPostgresAdapter({schema:()=>({rpc})});
    await expect(adapter.publishWorkPackageReleaseRequestBound(input)).rejects.toThrow();
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("passes only preview-derived coordinates to the native confirmation door", async () => {
    const rpc = vi.fn(async () => ({ data: {
      operation: "publish_work_package_release_request_bound", replay: false, stateRevision: 18,
      result: { id: "release:native-preview" },
    }, error: null }));
    const adapter = new ProjectBrainHumanPostgresAdapter({ schema: () => ({ rpc }) });
    await adapter.publishNativeM3ReleaseRequestBound({
      ...input, expectedContextDigest: `sha256:${"a".repeat(64)}`,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("publish_native_m3_release_request_bound", {
      project_id: input.projectId, package_id: input.packageId,
      expected_baseline_id: input.expectedBaselineId,
      expected_previous_version_id: input.expectedPreviousVersionId,
      expected_state_revision: input.expectedStateRevision,
      expected_context_digest: `sha256:${"a".repeat(64)}`,
      command_ref: input.commandRef, idempotency_key: input.idempotencyKey,
    });
  });
});
