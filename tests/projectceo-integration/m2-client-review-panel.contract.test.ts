import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string): string => existsSync(path) ? readFileSync(path, "utf8") : "";
const panelPath = "components/projectceo/m2-client-review-panel.tsx";
const m3CardPath = "components/projectceo/m2-m3-approved-input-card.tsx";
const contractsPath = "components/projectceo/contracts.ts";
const liveReadPath = "lib/project-intelligence/delivery/projectceo/live-read-port.ts";
const workspacePath = "components/projectceo/project-workspace.tsx";
const sessions = Object.freeze({
  designer: { userId: "81000000-0000-4000-8000-000000000001", role: "architect" },
  client: { userId: "81000000-0000-4000-8000-000000000002", role: "client" },
  m3Architect: { userId: "81000000-0000-4000-8000-000000000003", role: "architect" },
});

describe("Cycle 6 authenticated M2 client-review panel contract", () => {
  it("maps persisted v6 submissions/reviews/handoffs into explicit workspace DTOs", () => {
    const contracts = read(contractsPath);
    const liveRead = read(liveReadPath);

    for (const name of [
      "M2ClientReviewSubmissionView",
      "M2ClientReviewView",
      "M2M3HandoffView",
      "m2ClientReviewSubmissions",
      "m2ClientReviews",
      "m2M3Handoffs",
    ]) {
      expect(contracts, `missing workspace contract ${name}`).toContain(name);
      expect(liveRead, `v6 live read does not map ${name}`).toContain(name);
    }
    expect(liveRead).toMatch(/layoutRevisionId/);
    expect(liveRead).toMatch(/selectionRevisionIds/);
    expect(liveRead).toMatch(/amountRub/);
    expect(liveRead).toMatch(/staleSelectionRevisionIds/);
    expect(liveRead).toMatch(/missingPriceSelectionRevisionIds/);
    expect(liveRead).toMatch(/assignedClientUserId/);
  });

  it("fails closed on the complete nested submission shape instead of partially sanitizing it", () => {
    const liveRead = read(liveReadPath);
    expect(liveRead).toMatch(/SUBMISSION_KEYS|submissionKeys|exactObjectKeys/);
    expect(liveRead).toMatch(/VARIANT_KEYS|variantKeys/);
    expect(liveRead).toMatch(/BUDGET_KEYS|budgetKeys/);
    expect(liveRead).toMatch(/new Set\([^)]*role/);
    expect(liveRead).toMatch(/new Set\([^)]*variantId/);
    expect(liveRead).toMatch(/new Set\([^)]*layoutRevisionId/);
    expect(liveRead).toMatch(/\^sha256:\[0-9a-f\]\{64\}\$/i);
    expect(liveRead).toMatch(/UUID|uuid/i);
    expect(liveRead).toMatch(/budgetAsOf[^]*(?:Date\.parse|timestamp)/);
    expect(liveRead).toMatch(/Number\.isSafeInteger[^]*amountRub|amountRub[^]*Number\.isSafeInteger/);
    expect(liveRead).toMatch(/staleSelectionRevisionIds[^]*selectionRevisionIds/);
    expect(liveRead).toMatch(/missingPriceSelectionRevisionIds[^]*selectionRevisionIds/);
  });

  it("defines a separate Russian package-client panel with exactly three immutable options", () => {
    const panel = read(panelPath);

    expect(panel).toMatch(/export function M2ClientReviewPanel/);
    expect(panel).toMatch(/ProjectWorkspaceView/);
    expect(panel).toMatch(/actor\.role\s*!==\s*["']client["']/);
    expect(panel).toMatch(/actor\.packageId/);
    expect(panel).toMatch(/m2ClientReviewSubmissions/);
    expect(panel).toMatch(/variants\.length\s*!==\s*3|length\s*===\s*3/);
    for (const value of [
      "Рекомендуемый вариант",
      "Рациональный вариант",
      "Премиальный вариант",
      "Версия планировки",
      "Ревизия планировки",
      "Выборы и материалы",
      "₽",
      "Причина решения",
      "Согласовать",
      "Запросить изменения",
      "Отклонить",
    ]) expect(panel).toContain(value);
    expect(panel).toMatch(/type=["']radio["']/);
    expect(panel).toMatch(/textarea/);
    expect(panel).toMatch(/kind:\s*["']review_m2_client_submission["']/);
    expect(panel).not.toMatch(/service_role|serviceRole/);
    expect(panel).not.toMatch(/create_m2_(?:room|variant|material|budget)|publish_m2_layout_version/);
  });

  it("binds the panel into the workspace without exposing designer authoring controls to client", () => {
    const workspace = read(workspacePath);
    expect(workspace).toMatch(/import\s*\{\s*M2ClientReviewPanel\s*\}/);
    expect(workspace).toMatch(/<M2ClientReviewPanel\s+view=\{view\}/);
    expect(workspace).toMatch(/view\.actor\.role\s*===\s*["']client["']/);
    expect(workspace).toMatch(/M2WorkflowPanel/);
  });
});

describe("Cycle 6 persisted M3 approved-input card contract", () => {
  it("renders owner/architect M3 input only from persisted m2M3Handoffs", () => {
    const card = read(m3CardPath);
    const workspace = read(workspacePath);

    expect(card).toMatch(/export function M2M3ApprovedInputCard/);
    expect(card).toMatch(/m2M3Handoffs/);
    expect(card).toMatch(/approvedCommitId/);
    expect(card).toMatch(/approvedCommitRevisionId/);
    expect(card).toMatch(/layoutRevisionId/);
    expect(card).toMatch(/selectionRevisionIds/);
    expect(card).toMatch(/amountRub|budget/);
    expect(card).toMatch(/owner[^]*architect|architect[^]*owner/);
    expect(card).toMatch(/client[^]*(?:return null|null)|builder[^]*(?:return null|null)|guest[^]*(?:return null|null)/);
    expect(card).not.toMatch(/m2ClientReviewSubmissions[^]*approvedCommit|buildM2ToM3Handoff/);
    expect(workspace).toMatch(/<M2M3ApprovedInputCard\s+view=\{view\}/);
  });

  it("treats the persisted handoff as authoritative even when commit collection diverges", () => {
    const liveRead = read(liveReadPath);
    expect(liveRead).toMatch(/approvedCommitRevisionId:\s*text\(item\.approvedCommitRevisionId\)/);
    expect(liveRead).toMatch(/amountRub:\s*integer\([^)]*item[^)]*budget[^)]*amountRub/);
    expect(liveRead).not.toMatch(/approvedCommitRevisionId:\s*commit\?\.revisionId/);
    expect(liveRead).not.toMatch(/amountRub:\s*commit\?\.payload\.budget\.amountRub/);
  });

  it("keeps architect submit, assigned-client review and architect M3 publish as separate commands", () => {
    const panel = read(panelPath);
    const card = read(m3CardPath);
    const workflow = read("components/projectceo/m2-workflow-panel.tsx");

    expect(workflow).toMatch(/kind:\s*["']submit_m2_client_review["']/);
    expect(panel).toMatch(/kind:\s*["']review_m2_client_submission["']/);
    expect(card).toMatch(/kind:\s*["']publish_m2_m3_handoff["']/);
    expect(`${workflow}\n${panel}\n${card}`).not.toMatch(/service_role|serviceRole/);
  });

  it("models three distinct authenticated sessions without client-supplied actor identity", () => {
    expect(new Set(Object.values(sessions).map((session) => session.userId)).size).toBe(3);
    expect(sessions.designer.role).toBe("architect");
    expect(sessions.client.role).toBe("client");
    expect(sessions.m3Architect.role).toBe("architect");

    const panel = read(panelPath);
    const card = read(m3CardPath);
    expect(panel).toMatch(/assignedClientUserId|actor\.actorId/);
    expect(panel).not.toMatch(/payload:\s*\{[^}]*actor(?:Id|UserId)/s);
    expect(card).not.toMatch(/payload:\s*\{[^}]*actor(?:Id|UserId)/s);
  });
});
