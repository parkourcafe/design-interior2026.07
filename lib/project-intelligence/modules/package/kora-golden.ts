import { createHash } from "node:crypto";
import { semanticSha256 } from "../../application/change-handoff/canonical";
import { compareCodePoints } from "../../ordering";
import type {
  ConflictReview,
  KoraInventoryRecord,
  ProjectPackage,
  SourceDocumentStatus,
  SourceMediaKind,
} from "./contracts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function uuidFrom(value: string): string {
  const raw = sha256(value).slice(0, 32).split("");
  raw[12] = "4";
  raw[16] = "8";
  const hex = raw.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const PACKAGE_IDS = {
  root: "33333333-3333-4333-8333-333333333333",
  architecture: "44444444-4444-4444-8444-444444444441",
  engineering: "44444444-4444-4444-8444-444444444442",
  controls: "44444444-4444-4444-8444-444444444443",
  evidence: "44444444-4444-4444-8444-444444444444",
} as const;

const packages: readonly ProjectPackage[] = [
  {
    id: PACKAGE_IDS.root,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    parentPackageId: null,
    kind: "project_root",
    stableKey: "project-root",
    name: "Полный проект",
    status: "active",
  },
  {
    id: PACKAGE_IDS.architecture,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    parentPackageId: PACKAGE_IDS.root,
    kind: "work_package",
    stableKey: "architecture-release",
    name: "Архитектурный выпуск",
    status: "active",
  },
  {
    id: PACKAGE_IDS.engineering,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    parentPackageId: PACKAGE_IDS.root,
    kind: "work_package",
    stableKey: "engineering-release",
    name: "Инженерный выпуск",
    status: "active",
  },
  {
    id: PACKAGE_IDS.controls,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    parentPackageId: PACKAGE_IDS.root,
    kind: "work_package",
    stableKey: "project-controls-release",
    name: "Управление проектом",
    status: "active",
  },
  {
    id: PACKAGE_IDS.evidence,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    parentPackageId: PACKAGE_IDS.root,
    kind: "work_package",
    stableKey: "site-evidence-release",
    name: "Полевые подтверждения",
    status: "active",
  },
];

function packageForDiscipline(discipline: string): string {
  if (discipline === "architecture" || discipline === "visualization") {
    return PACKAGE_IDS.architecture;
  }
  if (discipline === "mep") return PACKAGE_IDS.engineering;
  if (
    discipline === "project_controls"
    || discipline === "quantity_cost"
    || discipline === "brief_specification"
  ) return PACKAGE_IDS.controls;
  return PACKAGE_IDS.evidence;
}

function mediaKindForExtension(extension: string): SourceMediaKind {
  if (extension === "pdf") return "pdf";
  if (extension === "xlsx") return "spreadsheet";
  if (["png", "jpg", "jpeg", "heic"].includes(extension)) return "image";
  if (extension === "md") return "plain_text";
  if (extension === "docx") return "document";
  if (extension === "dwg") return "cad_binary";
  if (extension === "rar" || extension === "zip") return "archive";
  throw new Error(`Unsupported Kora fixture extension: ${extension}`);
}

export interface KoraSourceManifestInput {
  readonly summary: {
    readonly physicalSources: number;
    readonly materializedSources: number;
    readonly cloudPlaceholders: number;
    readonly uniqueMaterializedBlobs: number;
    readonly duplicateHashGroups: number;
    readonly semanticNameConflictGroups: number;
    readonly byStatus: {
      readonly current: number;
      readonly previous: number;
      readonly reference: number;
      readonly unknown: number;
    };
  };
  readonly inventory: readonly {
    readonly id: string;
    readonly ext: string;
    readonly sizeBytes: number;
    readonly availability: "local" | "cloud_placeholder";
    readonly status: SourceDocumentStatus;
    readonly sha256: string | null;
    readonly semanticConflict: boolean;
    readonly floor: string;
    readonly discipline: string;
  }[];
}

export interface KoraProjectBrainGolden {
  readonly schemaVersion: "project-ceo-kora-golden/0.1";
  readonly sanitized: true;
  readonly generatedFrom: "sanitized-kora-source-manifest";
  readonly organizationId: string;
  readonly projectId: string;
  readonly projectProfile: {
    readonly name: "Kora Food Hall";
    readonly areaM2: 1800;
    readonly model: "full_project";
  };
  readonly packages: readonly ProjectPackage[];
  readonly inventory: readonly KoraInventoryRecord[];
  readonly exactHashIndex: Readonly<Record<string, readonly string[]>>;
  readonly conflictReviews: readonly ConflictReview[];
  readonly expectedSummary: {
    readonly physicalRecords: 209;
    readonly materializedRecords: 81;
    readonly placeholders: 128;
    readonly uniqueMaterializedBlobs: 28;
    readonly duplicateGroups: 18;
    readonly semanticConflictGroups: 8;
    readonly byStatus: {
      readonly current: 62;
      readonly previous: 17;
      readonly reference: 120;
      readonly unknown: 10;
    };
  };
  readonly scenario: {
    readonly baselineV1: {
      readonly id: string;
      readonly decisionRevisionIds: readonly string[];
      readonly selectionRevisionIds: readonly string[];
      readonly approvalPackageIds: readonly string[];
    };
    readonly noChange: {
      readonly reason: string;
    };
    readonly baselineV2: {
      readonly id: string;
      readonly decisionRevisionIds: readonly string[];
      readonly selectionRevisionIds: readonly string[];
      readonly approvalPackageIds: readonly string[];
    };
    readonly changeRequestId: string;
    readonly dependencies: readonly {
      readonly fromRevisionId: string;
      readonly toRevisionId: string;
      readonly relation: "depends_on";
    }[];
    readonly expectedImpacts: readonly {
      readonly rootRevisionId: string;
      readonly impactedRevisionId: string;
      readonly distance: number;
    }[];
  };
  readonly fixtureHash: `sha256:${string}`;
}

export function buildKoraProjectBrainGolden(
  manifest: KoraSourceManifestInput,
): KoraProjectBrainGolden {
  if (
    manifest.inventory.length !== manifest.summary.physicalSources
    || manifest.summary.physicalSources !== 209
    || manifest.summary.materializedSources !== 81
    || manifest.summary.cloudPlaceholders !== 128
    || manifest.summary.uniqueMaterializedBlobs !== 28
    || manifest.summary.duplicateHashGroups !== 18
    || manifest.summary.semanticNameConflictGroups !== 8
  ) {
    throw new Error("Kora source manifest does not match the frozen 209-record profile.");
  }
  const inventory: KoraInventoryRecord[] = manifest.inventory.map((record, index) => {
    const materialized = record.availability === "local";
    if (materialized !== (record.sha256 !== null)) {
      throw new Error(`Kora materialization/checksum mismatch: ${record.id}`);
    }
    const extension = record.ext.toLowerCase();
    const sequence = String(index + 1).padStart(3, "0");
    return {
      physicalRecordId: uuidFrom(`kora-physical-record:${record.id}`),
      sanitizedName: `source-${sequence}.${extension}`,
      hierarchy: {
        projectId: PROJECT_ID,
        packageId: packageForDiscipline(record.discipline),
        floorId: `floor-${record.floor}`,
        zoneId: `zone-${record.floor}`,
        disciplineId: record.discipline,
      },
      availability: materialized ? "materialized" : "placeholder",
      documentStatus: record.status,
      mediaKind: mediaKindForExtension(extension),
      sizeBytes: record.sizeBytes,
      checksum: record.sha256,
      sourceRevisionId: materialized
        ? uuidFrom(`kora-source-revision:sha256:${record.sha256}`)
        : null,
      semanticConflict: record.semanticConflict,
    };
  });

  const exactHashIndex: Record<string, string[]> = {};
  for (const record of inventory) {
    if (!record.checksum) continue;
    const aliases = exactHashIndex[record.checksum] ?? [];
    aliases.push(record.physicalRecordId);
    exactHashIndex[record.checksum] = aliases;
  }
  for (const aliases of Object.values(exactHashIndex)) aliases.sort();

  const conflictReviews: ConflictReview[] = Object.entries(exactHashIndex)
    .filter(([checksum]) => inventory.some((record) => (
      record.checksum === checksum && record.semanticConflict
    )))
    .sort(([left], [right]) => compareCodePoints(left, right))
    .map(([checksum], index) => ({
      checksum,
      disposition: "resolved",
      actor: { actorId: "member-architect", actorType: "human" },
      reviewedAt: `2026-07-17T${String(6 + index).padStart(2, "0")}:00:00Z`,
      reason: "Смысл дубликатов проверен человеком по защищённой проекции.",
    }));

  const selectionV1 = uuidFrom("selection-floor-finish-r1");
  const selectionV2 = uuidFrom("selection-floor-finish-r2");
  const estimateV2 = uuidFrom("estimate-floor-finish-r2");
  const procurementV2 = uuidFrom("procurement-floor-finish-r2");
  const releaseV2 = uuidFrom("release-floor-finish-r2");
  const withoutHash = {
    schemaVersion: "project-ceo-kora-golden/0.1" as const,
    sanitized: true as const,
    generatedFrom: "sanitized-kora-source-manifest" as const,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    projectProfile: {
      name: "Kora Food Hall" as const,
      areaM2: 1800 as const,
      model: "full_project" as const,
    },
    packages,
    inventory,
    exactHashIndex,
    conflictReviews,
    expectedSummary: {
      physicalRecords: 209 as const,
      materializedRecords: 81 as const,
      placeholders: 128 as const,
      uniqueMaterializedBlobs: 28 as const,
      duplicateGroups: 18 as const,
      semanticConflictGroups: 8 as const,
      byStatus: manifest.summary.byStatus as {
        readonly current: 62;
        readonly previous: 17;
        readonly reference: 120;
        readonly unknown: 10;
      },
    },
    scenario: {
      baselineV1: {
        id: uuidFrom("kora-baseline-v1"),
        decisionRevisionIds: [uuidFrom("decision-floor-finish-r1")],
        selectionRevisionIds: [selectionV1],
        approvalPackageIds: [uuidFrom("approval-package-v1")],
      },
      noChange: {
        reason: "Повторная проверка не выявила изменений в exact revisions.",
      },
      baselineV2: {
        id: uuidFrom("kora-baseline-v2"),
        decisionRevisionIds: [uuidFrom("decision-floor-finish-r1")],
        selectionRevisionIds: [selectionV2],
        approvalPackageIds: [uuidFrom("approval-package-v2")],
      },
      changeRequestId: uuidFrom("kora-change-request-v2"),
      dependencies: [
        { fromRevisionId: selectionV2, toRevisionId: estimateV2, relation: "depends_on" as const },
        { fromRevisionId: estimateV2, toRevisionId: procurementV2, relation: "depends_on" as const },
        { fromRevisionId: procurementV2, toRevisionId: releaseV2, relation: "depends_on" as const },
      ],
      expectedImpacts: [
        { rootRevisionId: selectionV2, impactedRevisionId: estimateV2, distance: 1 },
        { rootRevisionId: selectionV2, impactedRevisionId: procurementV2, distance: 2 },
        { rootRevisionId: selectionV2, impactedRevisionId: releaseV2, distance: 3 },
      ],
    },
  };
  return {
    ...withoutHash,
    fixtureHash: semanticSha256(withoutHash),
  };
}
