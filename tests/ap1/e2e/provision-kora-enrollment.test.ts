import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () => readFileSync("tests/ap1/e2e/provision-kora.ts", "utf8");

describe("Kora disposable enrollment", () => {
  it("uses the authenticated scope door to establish package and role state after public identity bootstrap", () => {
    const provision = source();
    const koraBootstrap = provision.slice(provision.indexOf("const owner = users.find"), provision.indexOf("const ownerClient = createClient"));
    const enrollmentStart = provision.lastIndexOf('await rpc(ownerClient, "projectceo_api", "enroll_organization_project_scope"');
    const enrollment = provision.slice(enrollmentStart, provision.indexOf("const portfolio = await rpc", enrollmentStart));
    expect(koraBootstrap).toContain("insert into public.designers");
    expect(koraBootstrap).toContain("insert into public.projects");
    expect(koraBootstrap).not.toMatch(/projectceo_foundation|project_intelligence/);
    expect(enrollment).toContain("package_id: PACKAGE_IDS.engineering");
    expect(enrollment).toContain('{ userId: architect.id, role: "architect" }');
    expect(enrollment).toContain('{ userId: builder.id, role: "builder" }');
    expect(enrollment).toContain('{ userId: client.id, role: "client_approver" }');
  });

  it("uses the external owner for the project-wide source snapshot", () => {
    const provision = source();
    const snapshot = provision.slice(provision.indexOf("const afterIngestion = await scope()"), provision.indexOf("const versionId = published.result.version.id"));
    expect(snapshot).toContain('ownerClient, "projectceo_api", "publish_source_snapshot"');
    expect(snapshot).not.toContain('architectClient, "projectceo_api", "publish_source_snapshot"');
  });

  it("never asks the package-enrolled architect for operations outside the package template (DEC-040)", () => {
    const provision = source();
    const external = provision.slice(
      provision.indexOf("async function provisionExternalPackage"),
      provision.indexOf("const createdApproval = await rpc"),
    );
    // Пакетный шаблон architect: view_project, register_source,
    // acknowledge_release, create_change, upload_photo_evidence,
    // review_milestone. Решение, выбор и цена требуют revise_decision /
    // create_selection — их делает владелец с проектной областью.
    expect(external).not.toMatch(/architectClient/);
    for (const operation of ["append_decision_revision", "append_selection_revision", "append_price_observation"]) {
      expect(external).toMatch(new RegExp(`ownerClient, "projectceo_product_api", "${operation}"`));
    }
  });
});
