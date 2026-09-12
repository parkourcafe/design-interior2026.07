import { describe, expect, it } from "vitest";
import { validateR1ObjectBinding } from "./r1-object-binding";
describe("R1 object binding", () => { it("requires immutable representation and mapping evidence", () => { expect(validateR1ObjectBinding({objectRevisionId:"o",representationDigest:`sha256:${"a".repeat(64)}`,nodeKey:"n",transform:{x:0},mappingMethod:"manual",evidenceId:"e"}).nodeKey).toBe("n"); }); });
