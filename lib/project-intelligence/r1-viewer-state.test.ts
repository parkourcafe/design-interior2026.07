import { describe, expect, it } from "vitest";
import { resetR1ViewerCamera, validateR1ViewerState } from "./r1-viewer-state";
describe("R1 viewer state", () => { it("uses digest-only representations", () => { expect(validateR1ViewerState({representationDigest:`sha256:${"a".repeat(64)}`,camera:resetR1ViewerCamera()}).camera.zoom).toBe(1); expect(()=>validateR1ViewerState({representationDigest:"x",camera:resetR1ViewerCamera(),sourceUrl:"x"})).toThrow(); }); });
