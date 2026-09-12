export function validateR1ViewerState(input: { readonly representationDigest: string; readonly camera: { readonly yaw: number; readonly pitch: number; readonly zoom: number }; readonly selectedObjectId?: string; readonly sourceUrl?: string }) {
  if (input.sourceUrl !== undefined || !/^sha256:[a-f0-9]{64}$/.test(input.representationDigest)) throw new Error("r1_viewer_representation_invalid");
  const { yaw, pitch, zoom } = input.camera;
  if (![yaw,pitch,zoom].every(Number.isFinite) || zoom <= 0 || zoom > 100) throw new Error("r1_viewer_camera_invalid");
  return { ...input };
}
export const resetR1ViewerCamera = () => ({ yaw: 0, pitch: 0, zoom: 1 });
