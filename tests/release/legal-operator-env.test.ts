import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const publicKeys = [
  "NEXT_PUBLIC_SUPPORT_EMAIL",
  "NEXT_PUBLIC_LEGAL_OPERATOR_NAME",
  "NEXT_PUBLIC_LEGAL_OPERATOR_ADDRESS",
  "NEXT_PUBLIC_LEGAL_OPERATOR_EMAIL",
  "NEXT_PUBLIC_LEGAL_OPERATOR_PHONE",
] as const;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("public legal operator environment", () => {
  it("keeps personal contact values out of source and the env example", async () => {
    const envSource = await readFile(resolve(process.cwd(), "lib/env.ts"), "utf8");
    const envExample = await readFile(resolve(process.cwd(), ".env.example"), "utf8");

    expect(`${envSource}\n${envExample}`).not.toMatch(/gmail\.com/i);
    expect(`${envSource}\n${envExample}`).not.toMatch(/\+\d{9,}/);
    expect(envExample).toContain("NEXT_PUBLIC_SUPPORT_EMAIL=<support-email>");
    expect(envExample).toContain("NEXT_PUBLIC_LEGAL_OPERATOR_NAME=<legal-operator-name>");
    expect(envExample).toContain("NEXT_PUBLIC_LEGAL_OPERATOR_ADDRESS=<legal-operator-address>");
    expect(envExample).toContain("NEXT_PUBLIC_LEGAL_OPERATOR_EMAIL=<legal-operator-email>");
    expect(envExample).toContain("NEXT_PUBLIC_LEGAL_OPERATOR_PHONE=<legal-operator-phone>");
    expect(envExample).toContain("APPLE_TEAM_ID=<apple-team-id>");
  });

  it("documents every requested runtime variable", async () => {
    const envExample = await readFile(resolve(process.cwd(), ".env.example"), "utf8");
    for (const key of [
      "REMHAOS_M4_V2_V3_ENABLED",
      "REMHAOS_GOOGLE_DRIVE_REVOKE_ENABLED",
      "RELEASE_WORKER_MAX_ROWS",
      "IMPACT_WORKER_MAX_ROWS",
      "INGEST_WORKER_MAX_ROWS",
      "TELEGRAM_PROJECTION_MAX_ROWS",
      "TELEGRAM_NOTIFICATION_MAX_ROWS",
      "TELEGRAM_EXTRACTION_MAX_ROWS",
      "AP1_ROTATE_EXISTING_PASSWORD",
      "NEXT_DIST_DIR",
    ]) {
      expect(envExample).toMatch(new RegExp(`^${key}=`, "m"));
    }
  });

  it("warns and returns neutral placeholders when production env is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const key of publicKeys) vi.stubEnv(key, "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { legalOperator, supportEmail } = await import("../../lib/env");

    expect(supportEmail()).toBe("support@example.invalid");
    expect(legalOperator()).toEqual({
      name: "Оператор не указан",
      address: "Адрес не указан",
      email: "support@example.invalid",
      phone: "Телефон не указан",
    });
    const warningText = warn.mock.calls.flat().join("\n");
    for (const key of publicKeys) expect(warningText).toContain(key);
  });

  it("returns configured public values without warnings", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_EMAIL", "support@example.test");
    vi.stubEnv("NEXT_PUBLIC_LEGAL_OPERATOR_NAME", "Test Operator");
    vi.stubEnv("NEXT_PUBLIC_LEGAL_OPERATOR_ADDRESS", "Test Address");
    vi.stubEnv("NEXT_PUBLIC_LEGAL_OPERATOR_EMAIL", "legal@example.test");
    vi.stubEnv("NEXT_PUBLIC_LEGAL_OPERATOR_PHONE", "Test Phone");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { legalOperator, supportEmail } = await import("../../lib/env");

    expect(supportEmail()).toBe("support@example.test");
    expect(legalOperator()).toEqual({
      name: "Test Operator",
      address: "Test Address",
      email: "legal@example.test",
      phone: "Test Phone",
    });
    expect(warn).not.toHaveBeenCalled();
  });
});
