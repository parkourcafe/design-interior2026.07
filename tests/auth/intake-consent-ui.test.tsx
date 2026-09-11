// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import IntakeConsentGate from "@/app/i/[token]/IntakeConsentGate";
import { ru } from "@/lib/i18n/ru";
const document = { id: "11111111-1111-4111-8111-111111111111", purpose: "intake", body: "Approved exact text", operator: "Approved operator", version: "v1", sha256: "a".repeat(64) };
const response = (body: unknown, ok = true) => Promise.resolve({ ok, json: async () => body });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount() { return render(<IntakeConsentGate token="scope-token">{() => <div>Wizard mounted</div>}</IntakeConsentGate>); }
describe("intake consent mount boundary", () => {
  it("does not mount the wizard while status is unresolved", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    mount();
    expect(screen.queryByText("Wizard mounted")).toBeNull();
  });
  it("preserves disabled operation", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response({ enabled: false })));
    mount();
    expect(await screen.findByText("Wizard mounted")).toBeTruthy();
  });
  it("shows exact document with unchecked consent before mounting", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response({ enabled: true, document, accepted: false })));
    mount();
    expect(await screen.findByText(document.body)).toBeTruthy();
    expect(screen.getByText(document.operator)).toBeTruthy();
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByText("Wizard mounted")).toBeNull();
  });
  it("only mounts after durable acceptance and uses stable retry id", async () => {
    const fetch = vi.fn().mockImplementationOnce(() => response({ enabled: true, document, accepted: false })).mockImplementationOnce(() => response({}, false)).mockImplementationOnce(() => response({ receipt: { receiptId: "receipt" } }));
    vi.stubGlobal("fetch", fetch); mount();
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: ru.consent.acceptButton }));
    await screen.findByText(ru.consent.saveError);
    expect(screen.queryByText("Wizard mounted")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: ru.consent.acceptButton }));
    expect(await screen.findByText("Wizard mounted")).toBeTruthy();
    const first = JSON.parse((fetch.mock.calls as unknown as [string, { body: string }][])[1]![1].body);
    const second = JSON.parse((fetch.mock.calls as unknown as [string, { body: string }][])[2]![1].body);
    expect(first.requestId).toBe(second.requestId);
    expect(first.accepted).toBe(true);
  });
  it("retains withdrawal while no approved document is available", async () => {
    const fetch = vi.fn().mockImplementationOnce(() => response({ enabled: true, document: null, receipt: { receiptId: "receipt" }, accepted: false })).mockImplementationOnce(() => response({ ok: true }));
    vi.stubGlobal("fetch", fetch); mount();
    fireEvent.click(await screen.findByRole("button", { name: ru.consent.withdrawButton }));
    await waitFor(() => expect(screen.queryByRole("button", { name: ru.consent.withdrawButton })).toBeNull());
    expect(screen.queryByText("Wizard mounted")).toBeNull();
  });
});
