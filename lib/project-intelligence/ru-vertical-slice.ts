/** RU ProUp Renovation vertical-slice domain seams.
 * Pure contracts only: adapters (PDF/DWG/XLSX, storage, Telegram) stay outside.
 */

export type RuPackageFormat = 'pdf' | 'dwg-preview' | 'xlsx' | 'image' | 'message';
export type ProcurementState = 'planned' | 'requested' | 'ordered' | 'paid' | 'delivered' | 'accepted';

export interface RuPackageItem {
  id: string;
  format: RuPackageFormat;
  fileName: string;
  sha256: string;
  roomId?: string;
  revision?: string;
}

export interface RuImportPackage {
  projectId: string;
  sourceRevision: string;
  items: RuPackageItem[];
  importedAt: string;
}

export interface RuBaseline {
  projectId: string;
  version: string;
  rooms: Array<{ id: string; name: string; areaM2?: number }>;
  workItems: Array<{ id: string; roomId: string; title: string; discipline: string; qty?: number; unit?: string }>;
  materials: Array<{ id: string; roomId: string; title: string; qty?: number; unit?: string; plannedCostRub?: number }>;
  budgetRub?: number;
  targetDate?: string;
}

export interface RuWbsItem {
  id: string;
  parentId?: string;
  roomId?: string;
  discipline: string;
  title: string;
  dependsOn: string[];
  status: 'planned' | 'in_progress' | 'done' | 'blocked';
}

export interface RuEstimateLine {
  id: string;
  kind: 'work' | 'rough_material' | 'finish_material' | 'equipment';
  title: string;
  qty?: number;
  unit?: string;
  unitCostRub?: number;
}

export interface RuChangeOrder {
  id: string;
  baselineVersion: string;
  reason: string;
  initiatedBy: 'client' | 'designer' | 'contractor' | 'unknown';
  deltaCostRub: number;
  deltaDays: number;
  status: 'draft' | 'requested' | 'approved' | 'rejected';
}

export interface RuPhotoReport {
  id: string;
  roomId?: string;
  capturedAt: string;
  storagePath: string;
  note?: string;
  accepted: boolean;
}

export interface RuHandover {
  projectId: string;
  baselineVersion: string;
  acceptedRooms: string[];
  warrantyArchivePaths: string[];
  generatedAt: string;
  semanticHash: string;
}

export function validateRuImportPackage(input: RuImportPackage): string[] {
  const errors: string[] = [];
  if (!input.projectId) errors.push('project_id_required');
  if (!input.sourceRevision) errors.push('source_revision_required');
  if (!input.items.length) errors.push('package_items_required');
  const ids = new Set<string>();
  for (const item of input.items) {
    if (ids.has(item.id)) errors.push(`duplicate_item:${item.id}`);
    ids.add(item.id);
    if (!/^[a-f0-9]{64}$/i.test(item.sha256)) errors.push(`invalid_sha256:${item.id}`);
  }
  return errors;
}

export function buildRuWbs(baseline: RuBaseline): RuWbsItem[] {
  return baseline.workItems.map((item, index) => ({
    id: item.id,
    roomId: item.roomId,
    discipline: item.discipline,
    title: item.title,
    dependsOn: index ? [baseline.workItems[index - 1]!.id] : [],
    status: 'planned',
  }));
}

export function estimateRuRub(lines: RuEstimateLine[]): number {
  return lines.reduce((sum, line) => sum + (line.qty ?? 1) * (line.unitCostRub ?? 0), 0);
}

export function canAdvanceProcurement(from: ProcurementState, to: ProcurementState): boolean {
  const order: ProcurementState[] = ['planned', 'requested', 'ordered', 'paid', 'delivered', 'accepted'];
  return order.indexOf(to) === order.indexOf(from) + 1;
}

export function validateRuChangeOrder(change: RuChangeOrder): string[] {
  const errors: string[] = [];
  if (!change.id || !change.baselineVersion) errors.push('change_order_identity_required');
  if (!change.reason.trim()) errors.push('change_reason_required');
  if (!Number.isInteger(change.deltaDays)) errors.push('delta_days_must_be_integer');
  if (!Number.isInteger(change.deltaCostRub)) errors.push('delta_cost_must_be_integer_rub');
  return errors;
}

export function canHandover(handover: RuHandover, reports: RuPhotoReport[]): boolean {
  const acceptedPhotoRooms = new Set(reports.filter((report) => report.accepted && report.roomId).map((report) => report.roomId));
  const everyRoomDocumented = handover.acceptedRooms.length > 0 && handover.acceptedRooms.every((roomId) => acceptedPhotoRooms.has(roomId));
  return Boolean(handover.projectId && handover.baselineVersion && handover.semanticHash && everyRoomDocumented);
}
