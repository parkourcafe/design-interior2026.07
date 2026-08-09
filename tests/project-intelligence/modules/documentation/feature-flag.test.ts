import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isDocumentationModuleEnabled } from "@/lib/project-intelligence/delivery/projectceo/documentation-flag";

describe("Флаг модуля «Документация»", () => {
  it("выключен, пока не включён явно", () => {
    expect(isDocumentationModuleEnabled(undefined)).toBe(false);
    expect(isDocumentationModuleEnabled("")).toBe(false);
    expect(isDocumentationModuleEnabled("false")).toBe(false);
    // Ни "1", ни "TRUE" включением не считаются: единственная форма — "true",
    // иначе модуль однажды откроется опечаткой в окружении.
    expect(isDocumentationModuleEnabled("1")).toBe(false);
    expect(isDocumentationModuleEnabled("TRUE")).toBe(false);
    expect(isDocumentationModuleEnabled("true")).toBe(true);
  });

  it("объявлен в .env.example выключенным", () => {
    // Иначе разработчик, копирующий пример окружения, получит включённый
    // недостроенный модуль.
    const example = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    expect(example).toMatch(/^REMHAOS_DOCUMENTATION_ENABLED=false$/m);
  });
});
