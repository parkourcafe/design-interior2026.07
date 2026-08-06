export type LayoutIssueSeverity = "blocking" | "warning";

export interface LayoutIssue {
  code: string;
  severity: LayoutIssueSeverity;
  message: string;
  entityIds?: string[];
  path?: string;
}

export interface LayoutNode {
  id: string;
  xMm: number;
  yMm: number;
  locked: boolean;
  [key: string]: unknown;
}

export interface LayoutWall {
  id: string;
  startNodeId: string;
  endNodeId: string;
  thicknessMm: number;
  heightMm: number;
  kind: string;
  locked: boolean;
  label?: string;
  [key: string]: unknown;
}

export interface LayoutOpening {
  id: string;
  parentWallId: string;
  kind: string;
  offsetMm: number;
  widthMm: number;
  heightMm: number;
  sillMm: number;
  handing?: string;
  locked: boolean;
  label?: string;
  [key: string]: unknown;
}

export interface LayoutColumn {
  id: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  depthMm: number;
  baseZMm: number;
  heightMm: number;
  rotationDeg: number;
  locked: boolean;
  label?: string;
  [key: string]: unknown;
}

export interface LayoutObject {
  id: string;
  kind: string;
  xMm: number;
  yMm: number;
  zMm: number;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  rotationDeg: number;
  locked: boolean;
  label?: string;
  [key: string]: unknown;
}

export interface LayoutEntity {
  id: string;
  [key: string]: unknown;
}

export interface LayoutMaterial extends LayoutEntity {
  labelRu: string;
  baseColor: string;
  roughness: number;
  metalness: number;
  emissive: string;
  emissiveIntensity: number;
  provenance: string;
}

export interface LayoutMaterialAssignment extends LayoutEntity {
  targetId: string;
  surfaceRole: string;
  materialId: string;
}

export type LayoutLightKind = "ambient" | "directional" | "point" | "hemisphere";

export interface LayoutLight extends LayoutEntity {
  kind: LayoutLightKind;
  xMm: number;
  yMm: number;
  zMm: number;
  color: string;
  intensity: number;
  label: string;
  targetId?: string;
  groundColor?: string;
  distanceMm?: number;
  decay?: number;
}

export interface LayoutDocument {
  contractVersion: "archidom.layout-document/0.1" | string;
  documentId: string;
  projectId: string;
  name: string;
  canonicalUnits: "mm";
  stateRevision: number;
  floor: {
    id: string;
    label: string;
    elevationMm: number;
    clearHeightMm: number;
    [key: string]: unknown;
  };
  variant: {
    id: string;
    label: string;
    status: string;
    [key: string]: unknown;
  };
  nodes: LayoutNode[];
  walls: LayoutWall[];
  openings: LayoutOpening[];
  columns: LayoutColumn[];
  objects: LayoutObject[];
  clearanceZones: LayoutEntity[];
  materials: LayoutMaterial[];
  materialAssignments: LayoutMaterialAssignment[];
  lights: LayoutLight[];
  metadata: {
    sourceRefs: string[];
    warnings: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface LayoutCommandBase {
  commandId: string;
  idempotencyKey: string;
  documentId: string;
  expectedStateRevision: number;
  reasonCode: string;
  reason: string;
}

export type LayoutCommand = LayoutCommandBase &
  (
    | {
        type: "MOVE_OBJECT";
        payload: {
          objectId: string;
          xMm?: number;
          yMm?: number;
          zMm?: number;
        };
      }
    | {
        type: "UPDATE_COLUMN";
        payload: {
          columnId: string;
          xMm?: number;
          yMm?: number;
          widthMm?: number;
          depthMm?: number;
          baseZMm?: number;
          heightMm?: number;
          rotationDeg?: number;
        };
      }
    | {
        type: "UPDATE_OBJECT";
        payload: {
          objectId: string;
          xMm?: number;
          yMm?: number;
          zMm?: number;
          widthMm?: number;
          depthMm?: number;
          heightMm?: number;
          rotationDeg?: number;
        };
      }
    | {
        type: "UPDATE_OPENING";
        payload: {
          openingId: string;
          offsetMm?: number;
          widthMm?: number;
          heightMm?: number;
          sillMm?: number;
          handing?: string;
        };
      }
    | {
        type: "ASSIGN_MATERIAL";
        payload: {
          assignmentId: string;
          materialId: string;
        };
      }
  );

export interface LayoutValidationResult {
  valid: boolean;
  issues: LayoutIssue[];
}

export interface ApplyLayoutCommandResult {
  ok: boolean;
  document: LayoutDocument;
  issues: LayoutIssue[];
}

export interface LayoutFieldDiff {
  path: string;
  before: unknown;
  after: unknown;
}

export interface LayoutEntityDiff {
  entityId: string;
  entityType: string;
  fields: LayoutFieldDiff[];
}

export interface LayoutDocumentDiff {
  fromVersionId: string;
  toVersionId: string;
  addedEntityIds: string[];
  removedEntityIds: string[];
  changed: LayoutEntityDiff[];
}

export interface DerivedPoint {
  xMm: number;
  yMm: number;
}

export interface DerivedWallPolygon {
  wallId: string;
  polygon: DerivedPoint[];
}

export interface DerivedLayout {
  valid: boolean;
  issues: LayoutIssue[];
  wallPolygons: DerivedWallPolygon[];
  roomAreaMm2: number;
  bounds: {
    minXMm: number;
    minYMm: number;
    maxXMm: number;
    maxYMm: number;
  } | null;
  sceneProjection: {
    floor: LayoutDocument["floor"];
    nodes: LayoutNode[];
    walls: LayoutWall[];
    openings: LayoutOpening[];
    columns: LayoutColumn[];
    objects: LayoutObject[];
    lights: LayoutLight[];
  };
}
