import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../..");
const migrationPath = resolve(
  repoRoot,
  "supabase/migrations/20260802080000_projectceo_m2_layout_versions.sql",
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const readV5Body = migration.match(
  /create\s+function\s+projectceo_read_api\.get_project_workspace_read_v5\s*\([^)]*\)[^]*?as\s+\$function\$([^]*?)\$function\$;/i,
)?.[1] ?? "";

describe("M2 published LayoutDocument version additive persistence migration", () => {
  it("exists after approved commits and is transactional", () => {
    expect(migrationPath).toMatch(/20260802080000_/);
    expect(migration).toMatch(/^--[^]*\nbegin;/i);
    expect(migration.trimEnd()).toMatch(/commit;$/i);
  });

  it("adds published layout versions to the immutable M2 ledger without replacing history", () => {
    expect(migration).not.toMatch(/drop\s+table[^;]*m2_workspace_revisions/i);
    expect(migration).not.toMatch(/truncate\s+[^;]*m2_workspace_revisions/i);
    expect(migration).toContain("projectceo_product.m2_workspace_revisions");
    expect(migration).toMatch(/entity_kind[^;]*layout_version/i);
    expect(migration).toMatch(/status[^;]*published/i);
    expect(migration).toContain("projectceo_product_api.append_m2_workspace_revision");
  });

  it("extends the existing ledger status constraint so published is a real persisted status", () => {
    expect(migration).toMatch(
      /alter\s+table\s+projectceo_product\.m2_workspace_revisions[^]*drop\s+constraint\s+(?:if\s+exists\s+)?m2_workspace_revisions_status_check/i,
    );
    expect(migration).toMatch(
      /alter\s+table\s+projectceo_product\.m2_workspace_revisions[^]*add\s+constraint\s+m2_workspace_revisions_status_check[^]*check\s*\([^;]*status[^;]*'published'[^;]*\)/i,
    );
  });

  it("authorizes publication from request claims as a human with revise_decision", () => {
    expect(migration).toContain("projectceo_foundation._authorize_package_human");
    expect(migration).toMatch(/layout_version[^]*revise_decision/i);
    expect(migration).not.toMatch(/auth\.uid\s*\(\s*\)/i);
    expect(migration).not.toMatch(/service_role[^]*_authorize_package_human/i);
  });

  it("accepts only the exact layout-version payload envelope", () => {
    for (const field of [
      "versionId",
      "roomId",
      "variantId",
      "role",
      "semanticHash",
      "schemaVersion",
      "layoutContent",
    ]) {
      expect(migration).toContain(field);
    }
    expect(migration).toMatch(/jsonb_object_keys\s*\(\s*payload\s*\)/i);
    expect(migration).toMatch(
      /array\s*\[[^\]]*'layoutContent'[^\]]*'role'[^\]]*'roomId'[^\]]*'schemaVersion'[^\]]*'semanticHash'[^\]]*'variantId'[^\]]*'versionId'[^\]]*\]::text\[\]/i,
    );
    expect(migration).toMatch(/preferred[^]*value_engineered[^]*premium/i);
    expect(migration).toMatch(/project-ceo-m2-layout\/0\.1/i);
    expect(migration).toMatch(/sha256:\[0-9a-f\]\{64\}/i);
  });

  it("validates the embedded real LayoutDocument shape and its envelope cross-fields", () => {
    for (const field of [
      "contractVersion",
      "documentId",
      "projectId",
      "canonicalUnits",
      "stateRevision",
      "floor",
      "variant",
      "nodes",
      "walls",
      "openings",
      "columns",
      "objects",
      "clearanceZones",
      "materials",
      "materialAssignments",
      "lights",
      "metadata",
    ]) {
      expect(migration).toContain(field);
    }
    expect(migration).toMatch(/archidom\.layout-document\/0\.1/i);
    expect(migration).toMatch(/canonicalUnits[^;]*mm/i);
    expect(migration).toMatch(/layoutContent,documentId[^;]*(entity_id|entityId)/i);
    expect(migration).toMatch(/layoutContent,projectId[^;]*project_id/i);
    expect(migration).toMatch(/layoutContent,variant,id[^;]*variantId/i);
    expect(migration).toMatch(/layoutContent[^]*(nodes|walls)[^]*jsonb_typeof[^]*array/i);
  });

  it("uses one fail-closed DB validator with exact root and nested object key sets", () => {
    expect(migration).toMatch(
      /create(?:\s+or\s+replace)?\s+function\s+projectceo_product\._m2_validate_layout_document\s*\(/i,
    );
    expect(migration).toMatch(
      /jsonb_object_keys\s*\(\s*(?:layout_content|document|p_document)\s*\)[^]*array\s*\[[^\]]*'canonicalUnits'[^\]]*'clearanceZones'[^\]]*'columns'[^\]]*'contractVersion'[^\]]*'documentId'[^\]]*'floor'[^\]]*'lights'[^\]]*'materialAssignments'[^\]]*'materials'[^\]]*'metadata'[^\]]*'name'[^\]]*'nodes'[^\]]*'objects'[^\]]*'openings'[^\]]*'projectId'[^\]]*'stateRevision'[^\]]*'variant'[^\]]*'walls'[^\]]*\]/i,
    );
    for (const exactShape of [
      ["floor", "clearHeightMm", "elevationMm", "id", "label"],
      ["variant", "id", "label", "status"],
      ["metadata", "sourceRefs", "warnings"],
    ] as const) {
      const [objectName, ...fields] = exactShape;
      const fieldPattern = fields.map((field) => `'${field}'`).join("[^\\]]*");
      expect(migration).toMatch(
        new RegExp(`${objectName}[^;]*jsonb_object_keys[^;]*array\\s*\\[[^\\]]*${fieldPattern}[^\\]]*\\]`, "i"),
      );
    }
  });

  it("enforces exact entity shapes and scalar JSON types for every collection", () => {
    const entityShapes = [
      ["nodes", "id", "locked", "xMm", "yMm"],
      ["walls", "endNodeId", "heightMm", "id", "kind", "label", "locked", "startNodeId", "thicknessMm"],
      ["openings", "handing", "heightMm", "id", "kind", "label", "locked", "offsetMm", "parentWallId", "sillMm", "widthMm"],
      ["columns", "baseZMm", "depthMm", "heightMm", "id", "label", "locked", "rotationDeg", "widthMm", "xMm", "yMm"],
      ["objects", "depthMm", "heightMm", "id", "kind", "label", "locked", "rotationDeg", "widthMm", "xMm", "yMm", "zMm"],
      ["clearanceZones", "depthMm", "heightMm", "id", "kind", "label", "locked", "rotationDeg", "targetId", "widthMm", "xMm", "yMm", "zMm"],
      ["materials", "baseColor", "emissive", "emissiveIntensity", "id", "labelRu", "metalness", "provenance", "roughness"],
      ["materialAssignments", "id", "materialId", "surfaceRole", "targetId"],
      ["lights", "color", "decay", "distanceMm", "groundColor", "id", "intensity", "kind", "label", "targetId", "xMm", "yMm", "zMm"],
    ] as const;

    for (const [collection, ...requiredFields] of entityShapes) {
      const fieldPattern = requiredFields.map((field) => `'${field}'`).join("[^\\]]*");
      expect(migration).toMatch(
        new RegExp(`${collection}[^;]*jsonb_object_keys[^;]*array\\s*\\[[^\\]]*${fieldPattern}[^\\]]*\\]`, "i"),
      );
    }
    for (const typeGuard of ["string", "number", "boolean", "array", "object"]) {
      expect(migration).toMatch(new RegExp(`jsonb_typeof[^;]*'${typeGuard}'`, "i"));
    }
    expect(migration).toMatch(/(?:require|assert)[_ ]?(?:nonempty[_ ]?)?string/i);
    expect(migration).toMatch(/(?:require|assert)[_ ]?boolean/i);
    expect(migration).toMatch(/(?:require|assert)[_ ]?(?:finite[_ ]?)?number/i);
    expect(migration).toMatch(/stateRevision[^;]*(?:9007199254740991|safe_integer)/i);
    expect(migration).toMatch(/stateRevision[^;]*(?:>=\s*0|<\s*0)/i);
  });

  it("requires integer millimetres, globally unique stable IDs, and valid wall/opening geometry", () => {
    expect(migration).toMatch(/(?:Mm2?|_mm)\b[^;]*(?:trunc|floor|ceil|integer)/i);
    expect(migration).toMatch(/duplicate_stable_id|global[^;]*unique[^;]*id/i);
    expect(migration).toMatch(/floor[^]*variant[^]*(?:nodes|walls)[^]*(?:duplicate_stable_id|unique)/i);
    expect(migration).toMatch(/startNodeId[^]*endNodeId[^]*(?:missing_node|node_ids?)/i);
    expect(migration).toMatch(/thicknessMm[^;]*(?:>\s*0|<=\s*0)/i);
    expect(migration).toMatch(/heightMm[^;]*(?:>\s*0|<=\s*0)/i);
    expect(migration).toMatch(/parentWallId[^]*(?:missing_opening_parent|wall_ids?)/i);
    expect(migration).toMatch(/offsetMm[^]*widthMm[^]*(?:wall_length|opening_outside_wall)/i);
  });

  it("validates PBR/light ranges and all material, light, and assignment references", () => {
    expect(migration).toMatch(/roughness[^;]*(?:between\s+0\s+and\s+1|>=\s*0[^;]*<=\s*1)/i);
    expect(migration).toMatch(/metalness[^;]*(?:between\s+0\s+and\s+1|>=\s*0[^;]*<=\s*1)/i);
    expect(migration).toMatch(/emissiveIntensity[^;]*(?:between\s+0\s+and\s+100|>=\s*0[^;]*<=\s*100)/i);
    expect(migration).toMatch(/(?:baseColor|emissive)[^;]*#[0-9a-f]{6}/i);
    expect(migration).toMatch(/ambient[^]*directional[^]*hemisphere[^]*point/i);
    expect(migration).toMatch(/intensity[^;]*(?:100000|100_000)/i);
    expect(migration).toMatch(/materialId[^]*(?:missing_assigned_material|material_ids?)/i);
    expect(migration).toMatch(/targetId[^]*(?:missing_assignment_target|target_ids?)/i);
    expect(migration).toMatch(/lights[^]*targetId[^]*(?:missing_light_target|target_ids?)/i);
  });

  it("bounds the persisted UTF-8 JSON and rejects unsafe or non-finite geometry numbers", () => {
    expect(migration).toMatch(/octet_length[^;]*(layoutContent|layout_content)[^;]*65536/i);
    expect(migration).toMatch(/9007199254740991|safe_integer/i);
    expect(migration).toMatch(/isfinite|NaN|Infinity/i);
  });

  it("rejects excessive JSON depth, scalar values, and entity nodes before recursive canonical work", () => {
    expect(migration).toMatch(/(?:json_depth|max_depth)[^;]*(?:>|>=)[^;]*\d+/i);
    expect(migration).toMatch(/(?:json_value_count|value_count)[^;]*(?:>|>=)[^;]*\d+/i);
    expect(migration).toMatch(/(?:entity_count|node_count)[^;]*(?:>|>=)[^;]*\d+/i);

    expect(migration).toMatch(
      /append_m2_workspace_revision[^]*(?:json_depth|max_depth)[^]*(?:json_value_count|value_count)[^]*(?:entity_count|node_count)[^]*raise[^]*projectceo_product\._m2_layout_semantic_hash\s*\(/i,
    );
  });

  it("recomputes the semantic hash in PostgreSQL instead of trusting the supplied hash", () => {
    expect(migration).toMatch(/create(?:\s+or\s+replace)?\s+function\s+projectceo_product\._m2_layout_semantic_hash/i);
    expect(migration).toMatch(/jsonb_typeof[^]*jsonb_each|jsonb_array_elements[^]*jsonb_build/i);
    expect(migration).toMatch(/digest\s*\([^;]*sha256/i);
    expect(migration).toMatch(
      /payload\s*->>\s*'semanticHash'\s+is\s+distinct\s+from\s+projectceo_product\._m2_layout_semantic_hash\s*\(\s*payload\s*->\s*'layoutContent'\s*\)/i,
    );
  });

  it("defines semantic canonical ordering as C/code-point ordering independent of database collation", () => {
    expect(migration).toMatch(/collate\s+"C"|code[-_ ]?point/i);
    expect(migration).toMatch(/jsonb_object_keys|jsonb_each/i);
    expect(migration).toMatch(/order\s+by[^;]*collate\s+"C"/i);
    expect(migration).toMatch(/order\s+by[^;]*(?:->>\s*'id'|\.key)[^;]*collate\s+"C"/i);
  });

  it("keeps layout lineage package-bound and requires null expected revision for its first version", () => {
    expect(migration).toMatch(
      /if\s+v_current\s+is\s+null\s+then[^]*expected_revision_id\s+is\s+not\s+null[^]*stale_state/i,
    );
    expect(migration).toMatch(
      /v_current\.package_id\s+is\s+distinct\s+from\s+package_id|current[^;]*package[^;]*package/i,
    );
    expect(migration).toMatch(/organization_id\s*=\s*v_context\.organization_id/i);
    expect(migration).toMatch(/project_id\s*=\s*(?:append_m2_workspace_revision\.)?project_id/i);
  });

  it("never reuses a versionId anywhere in the same organization/project/package scope", () => {
    expect(migration).toMatch(
      /entity_kind\s*=\s*'layout_version'[^]*(?:payload\s*->>\s*'versionId'|version_id)[^]*organization_id[^]*project_id[^]*package_id/i,
    );
    expect(migration).toMatch(/version[_ ]?id[^]*(?:already_exists|duplicate|nonreuse|cannot be reused)/i);
    expect(migration).toMatch(/organization_id\s*=\s*v_context\.organization_id/i);
    expect(migration).toMatch(/project_id\s*=\s*(?:append_m2_workspace_revision\.)?project_id/i);
    expect(migration).toMatch(/package_id\s*=\s*(?:append_m2_workspace_revision\.)?package_id/i);
  });

  it("records a dedicated publication operation and append-only audit event", () => {
    expect(migration).toContain("append_m2_layout_version_revision");
    expect(migration).toContain("m2_layout_version_revision_appended");
    expect(migration).toMatch(/command_records_operation_check/i);
    expect(migration).toMatch(/audit_events_event_type_check/i);
    expect(migration).toContain("projectceo_product.audit_events");
  });

  it("makes approved commits reference an exact same-package published layout version", () => {
    expect(migration).toMatch(
      /entity_kind\s*=\s*'approved_commit'[^]*entity_kind\s*=\s*'layout_version'/i,
    );
    expect(migration).toMatch(/layout_revision\.package_id\s*=\s*package_id/i);
    expect(migration).toMatch(
      /layout_revision\.entity_id\s*=\s*payload\s*#>>\s*'\{chosenVariant,layoutDocumentId\}'/i,
    );
    expect(migration).toMatch(
      /layout_revision\.payload\s*->>\s*'versionId'\s*=\s*payload\s*#>>\s*'\{chosenVariant,layoutVersionId\}'/i,
    );
    expect(migration).toMatch(
      /layout_revision\.payload\s*->>\s*'semanticHash'\s*=\s*payload\s*#>>\s*'\{chosenVariant,semanticHash\}'/i,
    );
    expect(migration).toMatch(
      /layout_revision\.payload\s*->>\s*'variantId'\s*=\s*payload\s*#>>\s*'\{chosenVariant,variantId\}'/i,
    );
    expect(migration).toMatch(/layout_revision\.status\s*=\s*'published'/i);
  });

  it("makes approved commits match the published layout room and variant role exactly", () => {
    expect(migration).toMatch(
      /layout_revision\.payload\s*->>\s*'roomId'\s*=\s*payload\s*->>\s*'roomId'/i,
    );
    expect(migration).toMatch(
      /layout_revision\.payload\s*->>\s*'role'\s*=\s*payload\s*#>>\s*'\{chosenVariant,role\}'/i,
    );
  });

  it("adds read v5 on top of v4 with the full immutable published layout history", () => {
    expect(migration).toContain("projectceo_read_api.get_project_workspace_read_v5");
    expect(migration).toContain("projectceo_read_api.get_project_workspace_read_v4");
    expect(migration).not.toMatch(
      /create\s+or\s+replace\s+function\s+projectceo_read_api\.get_project_workspace_read_v4/i,
    );
    expect(migration).toContain("m2LayoutVersions");
    expect(readV5Body).toMatch(/entity_kind\s*=\s*'layout_version'/i);
    expect(readV5Body).toMatch(/status\s*=\s*'published'/i);
    expect(readV5Body).not.toMatch(/distinct\s+on|row_number\s*\(/i);
    expect(readV5Body).not.toMatch(
      /from\s+projectceo_product\.m2_workspace_revisions[^;]*limit\s+1/i,
    );
    expect(readV5Body).toMatch(
      /order\s+by\s+revision\.entity_id\s+collate\s+"C"\s*,\s*revision\.revision_no(?:\s+asc)?\s*,\s*revision\.revision_id\s+collate\s+"C"/i,
    );
  });

  it("projects exact version identity needed to list, load, diff, and re-read a just-published revision", () => {
    for (const field of [
      "documentId",
      "versionId",
      "revisionId",
      "revisionNo",
      "semanticHash",
      "roomId",
      "variantId",
      "role",
      "schemaVersion",
    ]) {
      expect(readV5Body).toContain(`'${field}'`);
    }
    expect(readV5Body).toMatch(/'documentId'\s*,\s*revision\.entity_id/i);
    expect(readV5Body).toMatch(
      /'versionId'\s*,\s*revision\.payload\s*->>\s*'versionId'/i,
    );
    expect(readV5Body).toMatch(/'revisionId'\s*,\s*revision\.revision_id/i);
    expect(readV5Body).toMatch(/'revisionNo'\s*,\s*revision\.revision_no/i);
  });

  it("preserves both package-filtered and project-wide read scope", () => {
    expect(migration).toMatch(
      /revision\.project_id\s*=\s*get_project_workspace_read_v5\.project_id/i,
    );
    expect(migration).toMatch(
      /get_project_workspace_read_v5\.package_id\s+is\s+null\s+or\s+revision\.package_id\s*=\s*get_project_workspace_read_v5\.package_id/i,
    );
  });

  it("returns an explicit role-safe projection rather than exposing private rows wholesale", () => {
    expect(migration).toMatch(/scope,role|v_role/i);
    expect(migration).toMatch(/jsonb_build_object\s*\([^;]*'payload'/i);
    expect(migration).not.toMatch(/row_to_json\s*\(\s*revision|to_jsonb\s*\(\s*revision/i);
    expect(migration).not.toMatch(/select\s+revision\.\*/i);
  });

  it("derives the read role server-side and withholds layoutContent only from builders", () => {
    const readV5Signature = migration.match(
      /create\s+function\s+projectceo_read_api\.get_project_workspace_read_v5\s*\(([^)]*)\)/i,
    )?.[1] ?? "";

    expect(migration).toMatch(/_authorize_package_human|request_role|v_role/i);
    expect(readV5Signature).not.toMatch(/\b(?:role|viewer_role)\b/i);
    expect(readV5Body).toMatch(
      /(?:builder|главпрораб)[^]*(?:revision\.)?payload\s*-\s*'layoutContent'/i,
    );
    expect(readV5Body).not.toMatch(
      /(?:builder|главпрораб)[^]*(?:payload\s*#-\s*'\{(?:versionId|semanticHash|roomId|variantId|role|schemaVersion)\}'|null\s+as\s+payload)/i,
    );
    expect(readV5Body).toMatch(/jsonb_build_object[^]*'layoutContent'/i);
    for (const reviewerRole of ["owner", "architect", "client_approver"]) {
      expect(migration).toMatch(new RegExp(`${reviewerRole}[^]*(?:layoutContent|payload)`, "i"));
    }
  });

  it("preserves private-table RLS and exposes only authenticated RPC execution", () => {
    expect(migration).not.toMatch(/disable\s+row\s+level\s+security/i);
    expect(migration).not.toMatch(
      /grant\s+(select|insert|update|delete|all)[^;]*m2_workspace_revisions/i,
    );
    expect(migration).toMatch(
      /revoke\s+all\s+on\s+function[^;]*append_m2_workspace_revision[^;]*from\s+public[^;]*anon[^;]*authenticated[^;]*service_role/is,
    );
    expect(migration).toMatch(
      /grant\s+execute\s+on\s+function[^;]*append_m2_workspace_revision[^;]*to\s+authenticated/is,
    );
    expect(migration).toMatch(
      /revoke\s+all\s+on\s+function[^;]*get_project_workspace_read_v5[^;]*from\s+public[^;]*anon[^;]*authenticated[^;]*service_role/is,
    );
    expect(migration).toMatch(
      /grant\s+execute\s+on\s+function[^;]*get_project_workspace_read_v5[^;]*to\s+authenticated/is,
    );
    expect(migration).toMatch(/security\s+definer/i);
    expect(migration).toMatch(/set\s+search_path\s*=\s*''/i);
  });
});
