export type StableId = string;
export type RotationDeg = 0 | 90 | 180 | 270;
export type IssueSeverity = "info" | "warning" | "blocking";

export interface Floor { id: StableId; label: string; elevationMm: number; clearHeightMm: number }
export interface Variant { id: StableId; label: string; status: "draft" | "review" | "approved" }
export interface NodeMm { id: StableId; xMm: number; yMm: number; locked: boolean }
export interface Wall { id: StableId; startNodeId: StableId; endNodeId: StableId; thicknessMm: number; heightMm: number; kind: "existing" | "partition"; locked: boolean; label: string }
export interface Opening { id: StableId; parentWallId: StableId; kind: "door" | "free_opening" | "window"; offsetMm: number; widthMm: number; heightMm: number; sillMm: number; handing?: "left" | "right" | "double" | "none"; locked: boolean; label: string }
export interface Column { id: StableId; xMm: number; yMm: number; widthMm: number; depthMm: number; baseZMm: number; heightMm: number; rotationDeg: RotationDeg; locked: boolean; label: string }
export interface PlacedObject { id: StableId; kind: "counter" | "sink" | "equipment" | "decor" | "service"; catalogKey?: string; xMm: number; yMm: number; zMm: number; widthMm: number; depthMm: number; heightMm: number; rotationDeg: RotationDeg; locked: boolean; label: string; notes?: string }
export interface PointMm { xMm: number; yMm: number }
export interface ClearanceZone { id: StableId; label: string; polygon: PointMm[]; severity: IssueSeverity; relatedObjectIds: StableId[] }
export interface Material { id: StableId; labelRu: string; baseColor: string; roughness: number; metalness: number; emissive: string; emissiveIntensity: number; textureRef?: string; provenance: string }
export type SurfaceRole = "all" | "front" | "back" | "side" | "top" | "floor" | "ceiling" | "interior" | "exterior";
export interface MaterialAssignment { id: StableId; targetId: StableId; surfaceRole: SurfaceRole; materialId: StableId }
export interface Light { id: StableId; kind: "ambient" | "directional" | "point" | "linear_proxy"; xMm: number; yMm: number; zMm: number; color: string; intensity: number; targetId?: StableId; label: string }
export interface LayoutMetadata { sourceRefs: string[]; warnings: string[] }

export interface LayoutDocument {
  contractVersion: "archidom.layout-document/0.1";
  documentId: StableId;
  projectId: StableId;
  name: string;
  canonicalUnits: "mm";
  stateRevision: number;
  floor: Floor;
  variant: Variant;
  nodes: NodeMm[];
  walls: Wall[];
  openings: Opening[];
  columns: Column[];
  objects: PlacedObject[];
  clearanceZones: ClearanceZone[];
  materials: Material[];
  materialAssignments: MaterialAssignment[];
  lights: Light[];
  metadata: LayoutMetadata;
}

export interface ValidationIssue { code: string; severity: IssueSeverity; entityIds: StableId[]; messageKey: string; details?: Record<string, unknown> }

export type LayoutCommandType = "MOVE_NODE" | "UPDATE_WALL" | "UPDATE_OPENING" | "UPDATE_COLUMN" | "MOVE_OBJECT" | "UPDATE_OBJECT" | "CREATE_OBJECT" | "DELETE_OBJECT" | "ASSIGN_MATERIAL" | "UPDATE_LIGHT" | "RESTORE_CHECKPOINT";
export interface LayoutCommand { commandId: StableId; idempotencyKey: string; documentId: StableId; expectedStateRevision: number; type: LayoutCommandType; payload: Record<string, unknown>; reasonCode: string; reason: string }
export interface CommandSuccess { ok: true; document: LayoutDocument; issues: ValidationIssue[]; replayed: boolean }
export interface CommandFailure { ok: false; code: "STATE_STALE" | "LOCKED" | "INVALID_COMMAND" | "VALIDATION_FAILED" | "IDEMPOTENCY_CONFLICT"; message: string; document: LayoutDocument; issues: ValidationIssue[] }
export type CommandResult = CommandSuccess | CommandFailure;

export interface LayoutVersion { contractVersion: "archidom.layout-version/0.1"; versionId: StableId; documentId: StableId; parentVersionId?: StableId; semanticHash: string; content: LayoutDocument; authorType: "human"; reasonCode: string; reason: string; createdAt: string; warnings: string[] }
