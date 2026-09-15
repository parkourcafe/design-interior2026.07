import { describe, expect, it } from "vitest";
import { validateTechnicalReference } from "./technical-reference";
describe("technical reference", () => { it("binds exact PDF region to exact revision", () => { expect(validateTechnicalReference({sheetRevisionId:"s",assetVersionId:"a",previewDigest:`sha256:${"a".repeat(64)}`,locator:{kind:"pdf",page:1,bbox:[0,0,1,1]},mappingMethod:"manual"}).locator.kind).toBe("pdf"); }); });
