import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import OperatorDetails from "../../app/legal/operator-details";
import PrivacyPage from "../../app/legal/privacy/page";
import ConsentPage from "../../app/legal/consent/page";
import { ru } from "../../lib/i18n/ru";

vi.mock("@/components/landing/nav", () => ({ default: () => null }));
vi.mock("@/lib/i18n/public", () => ({
  usePublicLocale: () => ({ dictionary: { ...ru.landing, app: ru.app } }),
}));

afterEach(() => vi.unstubAllEnvs());

describe("legal document review surfaces", () => {
  it("renders configured registration details, escapes content and omits missing address", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_LEGAL_OPERATOR_NAME", "Test <operator>");
    vi.stubEnv("NEXT_PUBLIC_LEGAL_OPERATOR_ADDRESS", "");
    vi.stubEnv("NEXT_PUBLIC_LEGAL_OPERATOR_EMAIL", "legal@example.test");
    vi.stubEnv("NEXT_PUBLIC_LEGAL_OPERATOR_PHONE", "+7 (000) 000-00-00");
    vi.stubEnv("NEXT_PUBLIC_LEGAL_OPERATOR_INN", "test-inn");
    vi.stubEnv("NEXT_PUBLIC_LEGAL_OPERATOR_OGRNIP", "test-ogrnip");
    vi.stubEnv("NEXT_PUBLIC_LEGAL_OPERATOR_REGISTRATION_AUTHORITY", "Test authority");
    vi.stubEnv("NEXT_PUBLIC_LEGAL_OPERATOR_REGISTRATION_DATE", "Test date");
    const html = renderToStaticMarkup(<OperatorDetails />);
    for (const value of ["Test &lt;operator&gt;", "test-inn", "test-ogrnip", "Test authority", "Test date"]) expect(html).toContain(value);
    expect(html).toContain('href="mailto:legal@example.test"');
    expect(html).toContain('href="tel:+70000000000"');
    expect(html).not.toContain("Адрес не указан");
  });

  it("does not create phone/email actions for neutral placeholders", () => {
    vi.stubEnv("NODE_ENV", "test");
    for (const key of ["NEXT_PUBLIC_SUPPORT_EMAIL", "NEXT_PUBLIC_LEGAL_OPERATOR_EMAIL", "NEXT_PUBLIC_LEGAL_OPERATOR_PHONE"]) vi.stubEnv(key, "");
    const html = renderToStaticMarkup(<OperatorDetails />);
    expect(html).not.toContain("mailto:");
    expect(html).not.toContain("tel:");
  });

  it("makes draft status explicit and does not offer consent acceptance", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_EMAIL", "");
    for (const Page of [PrivacyPage, ConsentPage]) {
      const html = renderToStaticMarkup(<Page />);
      expect(html).toContain(ru.landing.legal.draftBanner);
      expect(html).toContain('href="/support"');
      expect(html).not.toContain('type="checkbox"');
      expect(html).not.toContain("<form");
      expect(html).not.toContain("mailto:support@example.invalid");
    }
  });
});
