import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ project: vi.fn(), redirect: vi.fn((url: string) => { throw new Error(url); }) }));
vi.mock("next/navigation", () => ({ redirect: mock.redirect }));
vi.mock("@/lib/intake", () => ({ getProjectByIntakeToken: mock.project }));
vi.mock("@/lib/designer", () => ({ getDesignerPublic: async () => null }));
vi.mock("@/lib/base-url", () => ({ requestBaseUrl: async () => "https://app.invalid" }));
vi.mock("@/app/i/[token]/wizard", () => ({ default: () => null }));
vi.mock("@/app/i/[token]/consent/withdrawal", () => ({ default: () => null }));
import Page from "@/app/i/[token]/page";
import Management from "@/app/i/[token]/consent/page";
beforeEach(() => vi.clearAllMocks());
it("routes invalid or expired tokens to receipt management instead of dropping withdrawal", async () => {
  mock.project.mockResolvedValue(null);
  await expect(Page({ params: Promise.resolve({ token: "expired" }) })).rejects.toThrow("/i/expired/consent");
});
it("renders receipt management without resolving project existence", async () => {
  const page = await Management({ params: Promise.resolve({ token: "deleted" }) });
  expect(page.props.token).toBe("deleted"); expect(mock.project).not.toHaveBeenCalled();
});
