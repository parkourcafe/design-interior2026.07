import { describe, expect, it } from "vitest";
import { assertR1ProposalApproval } from "./r1-proposal-approval";
describe("R1 proposal approval", () => { it("requires approved exact revision and preserves self-approval disclosure", () => { expect(assertR1ProposalApproval({status:"approved",proposalRevisionId:"r",approvedRevisionId:"r",selfApproved:true}).selfApproved).toBe(true); expect(()=>assertR1ProposalApproval({status:"pending",proposalRevisionId:"r",approvedRevisionId:"r",selfApproved:false})).toThrow(); }); });
