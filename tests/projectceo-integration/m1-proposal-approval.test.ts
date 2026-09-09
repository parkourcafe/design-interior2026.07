import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/studio", () => ({ getStudio: vi.fn() }));
vi.mock("@/lib/proposal/latest", () => ({ getLatestProposal: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { getStudio } from "@/lib/studio";
import { getLatestProposal } from "@/lib/proposal/latest";
import { sendProposal } from "@/app/dashboard/projects/[id]/proposal/actions";

const projectId = "11111111-1111-4111-8111-111111111111";

function setup(approvalRequests: unknown) {
  const proposalSelect = vi.fn().mockReturnValue({
    maybeSingle: vi.fn().mockResolvedValue({ data: { id: "proposal-1" }, error: null }),
  });
  const proposalUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({ select: proposalSelect }),
  });
  const projectUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: null }),
  });
  const insert = vi.fn().mockResolvedValue({ error: null });
  const rpc = vi.fn().mockResolvedValue({ data: { requests: approvalRequests }, error: null });
  const client = {
    schema: vi.fn(() => ({ rpc })),
    from: vi.fn((table: string) => table === "proposals"
      ? { update: proposalUpdate }
      : table === "projects"
        ? { update: projectUpdate }
        : { insert }),
  };
  vi.mocked(createClient).mockResolvedValue(client as never);
  vi.mocked(getStudio).mockResolvedValue({ studioId: "studio-1" } as never);
  vi.mocked(getLatestProposal).mockResolvedValue({ id: "proposal-1", status: "draft" } as never);
  return { client, proposalUpdate, projectUpdate, insert, rpc };
}

describe("M1 proposal approval gate", () => {
  it("fails closed before proposal mutation without an approved project passport", async () => {
    const { client, proposalUpdate, projectUpdate, insert, rpc } = setup([{
      subjectKind: "project_passport",
      subjectId: projectId,
      status: "submitted",
    }]);

    await expect(sendProposal(projectId)).resolves.toEqual({
      ok: false,
      reason: "approval_required",
    });
    expect(rpc).toHaveBeenCalledWith("list_approval_requests", {
      p_project_id: projectId,
      p_status: "approved",
    });
    expect(client.from).not.toHaveBeenCalled();
    expect(proposalUpdate).not.toHaveBeenCalled();
    expect(projectUpdate).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("sends only when the request-bound project passport approval is approved", async () => {
    const { client, proposalUpdate, projectUpdate, insert } = setup([{
      subjectKind: "project_passport",
      subjectId: projectId,
      status: "approved",
    }]);

    await expect(sendProposal(projectId)).resolves.toEqual({ ok: true });
    expect(proposalUpdate).toHaveBeenCalledOnce();
    expect(projectUpdate).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledOnce();
    expect(client.from).toHaveBeenCalledWith("proposals");
    expect(client.from).toHaveBeenCalledWith("projects");
    expect(client.from).toHaveBeenCalledWith("events");
  });
});
