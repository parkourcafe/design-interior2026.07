import { z } from "zod";
import {
  assertSelectedGoogleDriveObject,
  googleDriveObjectSchema,
  type GoogleDriveSelectedObject,
} from "./policy";

export const googleDrivePickerResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cancelled") }).strict(),
  z.object({ kind: z.literal("selected"), object: googleDriveObjectSchema }).strict(),
]);

export type GoogleDrivePickerResult = z.infer<typeof googleDrivePickerResultSchema>;

/** Browser Picker callback boundary: only the selected object metadata crosses it. */
export function parseGoogleDrivePickerResult(value: unknown): GoogleDrivePickerResult {
  const result = googleDrivePickerResultSchema.parse(value);
  if (result.kind === "selected") assertSelectedGoogleDriveObject(result.object);
  return result;
}

export function selectedGoogleDriveObject(
  result: GoogleDrivePickerResult,
): GoogleDriveSelectedObject | null {
  return result.kind === "selected" ? result.object : null;
}
