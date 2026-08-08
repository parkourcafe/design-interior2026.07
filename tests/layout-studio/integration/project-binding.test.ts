import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const read = (path: string) => readFileSync(join(repoRoot, path), "utf8");

const EDITOR_PAGE = "app/dashboard/projects/[id]/layouts/[documentId]/page.tsx";
const LIST_PAGE = "app/dashboard/projects/[id]/layouts/page.tsx";
const API_ROUTE = "app/api/layout-studio/[documentId]/route.ts";

/**
 * Привязка планировки к проекту — это граница доступа, а не навигационное
 * удобство. Проверки ниже статические: они читают исходники, потому что
 * поднимать Next и Supabase в модульном тесте дороже, чем стоит сам инвариант.
 * Поведение RLS проверено отдельно, прогоном по живой базе
 * (DB_STORAGE_VERIFICATION_2026-08-08.md).
 */
describe("Планировки внутри проекта: границы доступа", () => {
  it("редактор отказывает, если планировка принадлежит другому проекту", () => {
    const source = read(EDITOR_PAGE);
    // Мало найти документ по id — надо сверить его проект с адресом. Иначе
    // чужой documentId в URL открыл бы планировку соседнего проекта студии.
    expect(source).toMatch(/row\.project_id\s*!==\s*id/);
    expect(source).toMatch(/notFound\(\)/);
  });

  it("обе страницы закрыты флагом модуля", () => {
    for (const path of [EDITOR_PAGE, LIST_PAGE]) {
      const source = read(path);
      expect(source, `${path}: нет проверки флага`).toMatch(
        /if\s*\(!isLayoutStudioEnabled\(\)\)\s*notFound\(\)/,
      );
    }
  });

  it("страницы читают базу от имени дизайнера, а не через service role", () => {
    for (const path of [EDITOR_PAGE, LIST_PAGE, API_ROUTE]) {
      const source = read(path);
      expect(source, `${path}: используется admin-клиент в обход RLS`).not.toMatch(
        /createAdminClient|SERVICE_ROLE/,
      );
      expect(source, `${path}: нет серверного клиента`).toMatch(
        /from "@\/lib\/supabase\/server"/,
      );
    }
  });

  it("роут проверяет подпись токена и отдаёт 404 при выключенном флаге", () => {
    const source = read(API_ROUTE);
    // getClaims проверяет подпись; getUser() ей уступает — та же причина, по
    // которой в proxy.ts оставлена версия основной ветки.
    expect(source).toMatch(/auth\.getClaims\(\)/);
    expect(source).not.toMatch(/auth\.getUser\(\)/);
    expect(source).toMatch(/isLayoutStudioEnabled\(\)/);
  });

  it("роут не даёт телу запроса адресовать другой документ", () => {
    const source = read(API_ROUTE);
    expect(source).toMatch(/body\.document\.documentId\s*!==\s*documentId/);
  });

  it("конфликт версии и устаревшая ревизия отдаются как 409, а не как успех", () => {
    const source = read(API_ROUTE);
    for (const code of ["STATE_STALE", "VERSION_IMMUTABLE", "CHECKPOINT_IMMUTABLE"]) {
      expect(source, `${code} не отображён в HTTP-код`).toMatch(
        new RegExp(`${code}:\\s*409`),
      );
    }
  });
});
