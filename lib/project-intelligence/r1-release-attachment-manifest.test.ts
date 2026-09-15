import { describe, expect, it } from "vitest";
import { validateR1ReleaseAttachmentManifest } from "./r1-release-attachment-manifest";
describe("R1 release attachment manifest", () => { it("requires exact refs and excludes URLs", () => { const x={handoffId:"h",handoffRevisionId:"r",packageId:"p",approvedSnapshotDigest:`sha256:${"a".repeat(64)}`,assetVersionIds:["a"],representationDigests:[`sha256:${"b".repeat(64)}`]}; expect(validateR1ReleaseAttachmentManifest(x).packageId).toBe("p"); expect(()=>validateR1ReleaseAttachmentManifest({...x,temporaryUrl:"x"})).toThrow(); }); });
