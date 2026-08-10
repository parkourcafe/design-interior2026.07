export function isLayoutStudioEnabled(
  value = process.env.ARCHIDOM_LAYOUT_STUDIO_ENABLED,
): boolean {
  return value === "true";
}
