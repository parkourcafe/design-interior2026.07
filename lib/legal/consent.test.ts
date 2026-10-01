import { describe, expect, it } from "vitest";
import {
  INTAKE_CONSENT_VERSION,
  consentOperatorLabel,
  consentStudioLabel,
  consentTextSha256,
  intakeConsentText,
} from "./consent";

const designer = (over: Partial<{ name: string; studio_name: string; email: string }>) => ({
  name: "", studio_name: "", email: "", profile: {}, ...over,
}) as never;

describe("intake consent text (оценка ПДн 01.10.2026)", () => {
  it("names the studio like the brief card does", () => {
    expect(consentStudioLabel(designer({ name: "Анна", studio_name: "Студия А" }))).toBe("Студия А (Анна)");
    expect(consentStudioLabel(designer({ name: "Анна" }))).toBe("Анна");
    expect(consentStudioLabel(designer({ email: "a@b.ru" }))).toBe("a@b.ru");
    expect(consentStudioLabel(null)).toBeNull();
  });

  it("names the studio and RemHaOS as the processor, with the operator when configured", () => {
    const text = intakeConsentText("Студия А (Анна)", "ИП Иванов И. И.");
    expect(text).toContain("Даю Студия А (Анна) согласие");
    expect(text).toContain("поручает обработку сервису RemHaOS (ИП Иванов И. И.)");
    expect(intakeConsentText("Студия А", null)).toContain("сервису RemHaOS.");
  });

  it("uses the service as the operator for a self-serve brief", () => {
    expect(intakeConsentText(null, null)).toMatch(/^Даю сервису RemHaOS согласие/);
  });

  it("reads the operator from the public env and ignores blanks", () => {
    expect(consentOperatorLabel("  ООО «Ромашка»  ")).toBe("ООО «Ромашка»");
    expect(consentOperatorLabel("   ")).toBeNull();
    expect(consentOperatorLabel(undefined)).toBeNull();
  });

  it("hashes the exact text and keeps a draft version", () => {
    expect(consentTextSha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(INTAKE_CONSENT_VERSION).toMatch(/^consent-draft-/);
  });
});
