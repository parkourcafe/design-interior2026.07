import { describe, expect, it } from "vitest";
import {
  resetR1ViewerCamera,
  R1_VIEWER_STATE_VERSION,
  validateR1ViewerState,
} from "./r1-viewer-state";

const projectId = "11111111-1111-4111-8111-111111111111";
const packageId = "22222222-2222-4222-8222-222222222222";
const submissionId = "33333333-3333-4333-8333-333333333333";
const releaseId = "44444444-4444-4444-8444-444444444444";
const grantId = "55555555-5555-4555-8555-555555555555";
const versionId = "66666666-6666-4666-8666-666666666666";
const accessEvidenceId = "77777777-7777-4777-8777-777777777777";
const representationDigest = `sha256:${"a".repeat(64)}`;

const baseState = {
  contractVersion: R1_VIEWER_STATE_VERSION,
  scope: {
    mode: "authenticated_review",
    projectId,
    packageId,
    submissionId,
  },
  representation: {
    versionId,
    digest: representationDigest,
    format: "glb",
    status: "current",
    displayLabel: "Модель · ревизия 2",
  },
  access: {
    lifecycle: "active",
    evidenceId: accessEvidenceId,
    revision: 4,
  },
  camera: resetR1ViewerCamera(),
  selection: null,
} as const;

describe("R1 viewer state contract", () => {
  it("returns a bounded GLB state with fixed private-delivery controls", () => {
    expect(validateR1ViewerState(baseState)).toEqual({
      ...baseState,
      presentation: {
        historical: false,
        warning: "none",
        byteRequestDisposition: "broker_authorization_required",
        newDispatchCandidate: true,
      },
      deliveryRequirements: {
        cacheControl: "private, no-store",
        requireBrokerAuthorizationPerRequest: true,
        maximumRangeReauthorizationIntervalMs: 1_000,
        prohibitRawStorageLocator: true,
      },
    });
  });

  it("normalizes negative zero in camera coordinates", () => {
    const result = validateR1ViewerState({
      ...baseState,
      camera: { ...resetR1ViewerCamera(), yaw: -0, target: [-0, 1, -0] },
    });
    expect(result.camera).toEqual({ kind: "3d", yaw: 0, pitch: 0, zoom: 1, target: [0, 1, 0] });
  });

  it("supports an exact guest release scope without accepting a raw grant token", () => {
    const result = validateR1ViewerState({
      ...baseState,
      scope: {
        mode: "guest_release",
        projectId,
        packageId,
        releaseId,
        grantId,
      },
    });
    expect(result.scope).toEqual({ mode: "guest_release", projectId, packageId, releaseId, grantId });
  });

  it("models superseded history separately from a current dispatch", () => {
    expect(validateR1ViewerState({
      ...baseState,
      representation: { ...baseState.representation, status: "superseded" },
    }).presentation).toEqual({
      historical: true,
      warning: "superseded_history",
      byteRequestDisposition: "broker_authorization_required",
      newDispatchCandidate: false,
    });
  });

  it("denies byte requests for revoked access without rewriting representation history", () => {
    expect(validateR1ViewerState({
      ...baseState,
      access: { ...baseState.access, lifecycle: "revoked" },
    }).presentation).toEqual({
      historical: false,
      warning: "access_revoked",
      byteRequestDisposition: "deny_revoked",
      newDispatchCandidate: false,
    });
  });

  it("represents superseded history and revoked access independently", () => {
    expect(validateR1ViewerState({
      ...baseState,
      representation: { ...baseState.representation, status: "superseded" },
      access: { ...baseState.access, lifecycle: "revoked" },
    }).presentation).toEqual({
      historical: true,
      warning: "access_revoked",
      byteRequestDisposition: "deny_revoked",
      newDispatchCandidate: false,
    });
  });

  it("supports a PDF page camera and normalized object region", () => {
    const result = validateR1ViewerState({
      ...baseState,
      representation: { ...baseState.representation, format: "pdf", displayLabel: "Лист A-101" },
      camera: { kind: "2d", page: 3, rotation: 90, zoom: 2, pan: [12, -8] },
      selection: {
        objectId: "room:living-01",
        representationDigest,
        region: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      },
    });
    expect(result.camera).toEqual({ kind: "2d", page: 3, rotation: 90, zoom: 2, pan: [12, -8] });
    expect(result.selection).toMatchObject({
      objectId: "room:living-01",
      representationDigest,
      region: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    });
  });

  it("uses a page-less 2D camera for PNG previews", () => {
    expect(validateR1ViewerState({
      ...baseState,
      representation: { ...baseState.representation, format: "png", displayLabel: "Фасад север" },
      camera: { kind: "2d", page: null, rotation: 0, zoom: 1, pan: [0, 0] },
    }).camera).toEqual({ kind: "2d", page: null, rotation: 0, zoom: 1, pan: [0, 0] });
  });

  it.each([
    ["top-level URL", { ...baseState, sourceUrl: "https://storage.invalid/object" }, "r1_viewer_state_invalid"],
    ["storage key", { ...baseState, storageKey: "private/object" }, "r1_viewer_state_invalid"],
    ["raw token", { ...baseState, token: "secret" }, "r1_viewer_state_invalid"],
    ["unknown version", { ...baseState, contractVersion: "r1-viewer-state/9.9" }, "r1_viewer_state_invalid"],
    ["bad digest", { ...baseState, representation: { ...baseState.representation, digest: "x" } }, "r1_viewer_representation_invalid"],
    ["unsafe label path", { ...baseState, representation: { ...baseState.representation, displayLabel: "private/model.glb" } }, "r1_viewer_display_label_invalid"],
    ["unsafe label URL", { ...baseState, representation: { ...baseState.representation, displayLabel: "https://example.invalid" } }, "r1_viewer_display_label_invalid"],
    ["unsafe label URI scheme", { ...baseState, representation: { ...baseState.representation, displayLabel: "javascript:alert(1)" } }, "r1_viewer_display_label_invalid"],
    ["extra representation field", { ...baseState, representation: { ...baseState.representation, bucket: "files" } }, "r1_viewer_representation_invalid"],
    ["invalid access", { ...baseState, access: { ...baseState.access, lifecycle: "allowed" } }, "r1_viewer_access_invalid"],
    ["forged access revision", { ...baseState, access: { ...baseState.access, revision: -1 } }, "r1_viewer_access_invalid"],
    ["mixed guest scope", { ...baseState, scope: { ...baseState.scope, releaseId, grantId } }, "r1_viewer_scope_invalid"],
    ["undefined guest fields in review scope", { ...baseState, scope: { ...baseState.scope, releaseId: undefined, grantId: undefined } }, "r1_viewer_scope_invalid"],
    ["raw guest token", { ...baseState, scope: { mode: "guest_release", projectId, packageId, releaseId, grantId, rawToken: "x" } }, "r1_viewer_scope_invalid"],
    ["undefined review field in guest scope", { ...baseState, scope: { mode: "guest_release", projectId, packageId, releaseId, grantId, submissionId: undefined } }, "r1_viewer_scope_invalid"],
    ["3D camera for PDF", { ...baseState, representation: { ...baseState.representation, format: "pdf" } }, "r1_viewer_camera_invalid"],
    ["undefined 2D field on 3D", { ...baseState, camera: { ...baseState.camera, page: undefined } }, "r1_viewer_camera_invalid"],
    ["2D camera for GLB", { ...baseState, camera: { kind: "2d", page: null, rotation: 0, zoom: 1, pan: [0, 0] } }, "r1_viewer_camera_invalid"],
    ["undefined 3D field on 2D", { ...baseState, representation: { ...baseState.representation, format: "png" }, camera: { kind: "2d", page: null, rotation: 0, zoom: 1, pan: [0, 0], yaw: undefined } }, "r1_viewer_camera_invalid"],
    ["sparse 3D target", { ...baseState, camera: { ...baseState.camera, target: new Array(3) } }, "r1_viewer_camera_invalid"],
    ["sparse 2D pan", { ...baseState, representation: { ...baseState.representation, format: "png" }, camera: { kind: "2d", page: null, rotation: 0, zoom: 1, pan: new Array(2) } }, "r1_viewer_camera_invalid"],
    ["unbounded zoom", { ...baseState, camera: { ...baseState.camera, zoom: 21 } }, "r1_viewer_camera_invalid"],
    ["non-finite camera", { ...baseState, camera: { ...baseState.camera, yaw: Number.NaN } }, "r1_viewer_camera_invalid"],
    ["fractional PDF page", { ...baseState, representation: { ...baseState.representation, format: "pdf" }, camera: { kind: "2d", page: 1.5, rotation: 0, zoom: 1, pan: [0, 0] } }, "r1_viewer_camera_invalid"],
    ["PNG page", { ...baseState, representation: { ...baseState.representation, format: "png" }, camera: { kind: "2d", page: 1, rotation: 0, zoom: 1, pan: [0, 0] } }, "r1_viewer_camera_invalid"],
    ["wrong selection digest", { ...baseState, selection: { objectId: "room:1", representationDigest: `sha256:${"b".repeat(64)}`, region: null } }, "r1_viewer_selection_invalid"],
    ["unsafe object ID", { ...baseState, selection: { objectId: "../room", representationDigest, region: null } }, "r1_viewer_selection_invalid"],
    ["region overflow", { ...baseState, selection: { objectId: "room:1", representationDigest, region: { x: 0.8, y: 0, width: 0.3, height: 1 } } }, "r1_viewer_region_invalid"],
    ["zero region", { ...baseState, selection: { objectId: "room:1", representationDigest, region: { x: 0, y: 0, width: 0, height: 1 } } }, "r1_viewer_region_invalid"],
    ["subnormal region", { ...baseState, selection: { objectId: "room:1", representationDigest, region: { x: 1, y: 0, width: Number.MIN_VALUE, height: 1 } } }, "r1_viewer_region_invalid"],
  ] as const)("fails closed for %s", (_name, input, error) => {
    expect(() => validateR1ViewerState(input)).toThrow(error);
  });
});
