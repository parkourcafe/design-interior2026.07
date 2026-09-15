import { describe, expect, it } from "vitest";
import { validateR1ReviewSubject } from "./r1-review-subject";
describe("R1 review subject", () => { it("rejects volatile URLs and self digests", () => { const input={assetVersionIds:["a"],representationDigests:[`sha256:${"a".repeat(64)}`],technicalReferenceIds:[],approvalIds:[]}; expect(validateR1ReviewSubject(input).assetVersionIds).toEqual(["a"]); expect(()=>validateR1ReviewSubject({...input,temporaryUrl:"x"})).toThrow("r1_review_subject_volatile_field_forbidden"); }); });
