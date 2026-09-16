import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { PostgresRpcClient } from "../../lib/project-intelligence/adapters/postgres";
import { projectCeoCommandSchema, type ProjectCeoCommand } from "../../lib/project-intelligence/delivery/projectceo/command-contract";
import { ProjectCeoCommandService } from "../../lib/project-intelligence/delivery/projectceo/command-service";
const projectId = "abcdef00-0000-4000-8000-000000000001";
const packageId = "abcdef00-0000-4000-8000-000000000002";
const dwg = "abcdef00-0000-4000-8000-000000000003";
const pdf = "abcdef00-0000-4000-8000-000000000004";
const command: Extract<ProjectCeoCommand, {kind: "confirm_pdf_dwg_source_pair"}> = {
  contractVersion: "projectceo-command/0.1", projectId, commandId: dwg,
  kind: "confirm_pdf_dwg_source_pair", payload: {packageId, dwgAssetVersionId: dwg, pdfAssetVersionId: pdf, reason: "Checked original pair"},
};
function fixture(options: {enabled?: string; packageScope?: string; replay?: boolean; error?: string; patch?: Record<string, unknown>; operation?: string} = {}) {
  const calls: {name: string; args: Readonly<Record<string, unknown>>}[] = [];
  const result = {confirmationId: dwg, schemaVersion: "r1-source-pair-confirmation/1", dwgAssetVersionId: dwg, pdfAssetVersionId: pdf,
    dwgRevision: 1, pdfRevision: 2, dwgSha256: "a".repeat(64), pdfSha256: "b".repeat(64), confirmedAt: "2026-09-16T00:00:00.000000Z",
    confirmationStatus: "architect_confirmed", conversionStatus: "unconfirmed", warning: "PDF предоставлен архитектором; DWG conversion не подтверждён", ...options.patch};
  const client: PostgresRpcClient = {schema: (schema) => ({rpc: async (fn, args = {}) => {
    calls.push({name: `${schema}.${fn}`, args});
    if (fn === "list_projects") return {data: {contractVersion: "project-ceo-foundation/0.1", requestId: "scope", error: null,
      data: [{projectId, organizationId: dwg, role: "architect", stateRevision: 99, accessScope: options.packageScope ? "package" : "project", packageId: options.packageScope}]}, error: null};
    if (fn !== "confirm_pdf_dwg_source_pair" || schema !== "projectceo_api") throw new Error("unexpected RPC");
    return options.error ? {data: null, error: {code: options.error, message: "denied"}} : {data: {operation: options.operation ?? command.kind, replay: options.replay ?? false, result}, error: null};
  }})};
  return {calls, result, service: new ProjectCeoCommandService({client, documentationEnabled: options.enabled ?? "true"})};
}
describe("R1 source-pair request command", () => {
  it("validates a strict source-only DTO", () => {
    expect(projectCeoCommandSchema.safeParse(command).success).toBe(true);
    for (const field of ["actorUserId", "sourceSha256", "role", "organizationId", "conversionStatus", "representationVersionId"]) {
      expect(projectCeoCommandSchema.safeParse({...command, payload: {...command.payload, [field]: "forged"}}).success).toBe(false);
      expect(projectCeoCommandSchema.safeParse({...command, [field]: "forged"}).success).toBe(false);
    }
    for (const reason of ["", " padded ", "x".repeat(2001)]) expect(projectCeoCommandSchema.safeParse({...command, payload: {...command.payload, reason}}).success).toBe(false);
    expect(projectCeoCommandSchema.safeParse({...command, payload: {...command.payload, pdfAssetVersionId: dwg}}).success).toBe(false);
  });
  it.each([false,true])("forwards six args and observed revision without changing receipt, replay=%s", async (replay) => {
    const f=fixture({replay});
    expect(await f.service.execute(command,"http")).toMatchObject({status:"completed",replay,stateRevision:99,result:f.result});
    expect(f.calls.map(c=>c.name)).toEqual(["projectceo_api.list_projects","projectceo_api.confirm_pdf_dwg_source_pair"]);
    expect(f.calls[1]?.args).toEqual({project_id:projectId,package_id:packageId,dwg_asset_version_id:dwg,pdf_asset_version_id:pdf,reason:command.payload.reason,idempotency_key:`ui:${projectId}:${command.kind}:${command.commandId}`});
  });
  it("canonicalizes uppercase selectors before scope and mutation", async () => {
    const f = fixture({packageScope: packageId});
    const upper = {...command, projectId: projectId.toUpperCase(), commandId: command.commandId.toUpperCase(), payload: {...command.payload, packageId: packageId.toUpperCase(), dwgAssetVersionId: dwg.toUpperCase(), pdfAssetVersionId: pdf.toUpperCase()}};
    expect(projectCeoCommandSchema.safeParse(upper).success).toBe(true);
    expect(await f.service.execute(upper,"upper")).toMatchObject({status:"completed", result:f.result});
    expect(f.calls[1]?.args).toEqual({project_id:projectId,package_id:packageId,dwg_asset_version_id:dwg,pdf_asset_version_id:pdf,reason:command.payload.reason,idempotency_key:`ui:${projectId}:${command.kind}:${command.commandId}`});
    expect(projectCeoCommandSchema.safeParse({...upper,payload:{...upper.payload,pdfAssetVersionId:dwg}}).success).toBe(false);
  });
  it("gates module before any RPC", async()=>{ const f=fixture({enabled:"false"}); expect(await f.service.execute(command,"http")).toMatchObject({status:"unavailable"}); expect(f.calls).toHaveLength(0); });
  it("denies another package before mutation RPC",async()=>{ const f=fixture({packageScope:pdf});expect(await f.service.execute(command,"http")).toMatchObject({status:"error"});expect(f.calls).toHaveLength(1); });
  it("accepts exact package scope",async()=>{const f=fixture({packageScope:packageId});expect(await f.service.execute(command,"http")).toMatchObject({status:"completed"});});
  it.each([{conversionStatus:"confirmed"},{dwgSha256:"invalid"},{pdfAssetVersionId:dwg},{warning:""},{privateLocator:"private/secret"}])("rejects malformed response %j",async(patch)=>{const f=fixture({patch});expect(await f.service.execute(command,"http")).toMatchObject({status:"error"});});
  it("rejects wrong operation",async()=>{const f=fixture({operation:"other"});expect(await f.service.execute(command,"http")).toMatchObject({status:"error"});});
  it("propagates safe permission denial",async()=>{const f=fixture({error:"P1103"});expect(await f.service.execute(command,"http")).toMatchObject({status:"error"});});
});
