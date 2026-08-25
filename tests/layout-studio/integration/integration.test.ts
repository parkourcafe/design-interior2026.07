// @vitest-environment node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  deriveLayout,
  validateLayoutDocument,
  type LayoutDocument,
} from "@/lib/layout-studio/domain";
import { createSvgProjection } from "@/lib/layout-studio/adapters/svg/svg-projection";
import { compileSceneDescriptor } from "@/lib/layout-studio/adapters/three/scene-compiler";

const repoRoot = process.cwd();
const fixturePath = join(
  repoRoot,
  "fixtures/layout-studio/liquid-station.synthetic.v0.1.json",
);

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function fixture(): LayoutDocument {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as LayoutDocument;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function allMillimeterValues(value: unknown, path = "fixture"): Array<[string, number]> {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => allMillimeterValues(item, `${path}[${index}]`));
  }
  if (!value || typeof value !== "object") return [];

  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
    const itemPath = `${path}.${key}`;
    const own = key.endsWith("Mm") && typeof item === "number"
      ? [[itemPath, item] as [string, number]]
      : [];
    return [...own, ...allMillimeterValues(item, itemPath)];
  });
}

describe("Layout Studio delivery/UI slice", () => {
  it("validates and deterministically derives the synthetic Liquid Station fixture", () => {
    const document = fixture();
    const validation = validateLayoutDocument(document);
    const first = deriveLayout(document);
    const second = deriveLayout(structuredClone(document));

    expect(validation.valid, JSON.stringify(validation.issues, null, 2)).toBe(true);
    expect(first.valid, JSON.stringify(first.issues, null, 2)).toBe(true);
    expect(second).toEqual(first);
    expect(first.roomAreaMm2).toBe(33_120_000);
    expect(allMillimeterValues(document).length).toBeGreaterThan(0);
    expect(allMillimeterValues(document).every(([, value]) => Number.isInteger(value))).toBe(true);

    const contour = document.walls.map((wall) => [wall.startNodeId, wall.endNodeId]);
    expect(contour.every((wall, index) => wall[1] === contour[(index + 1) % contour.length]?.[0])).toBe(true);
    expect(document.openings).toHaveLength(2);
    expect(document.columns).toContainEqual(
      expect.objectContaining({
        id: "column.synthetic-liquid-station.structural",
        widthMm: 250,
        depthMm: 250,
      }),
    );
    expect(document.objects.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        "object.synthetic-liquid-station.front-counter",
        "object.synthetic-liquid-station.central-double-sink",
        "object.synthetic-liquid-station.rear-coffee-machine",
      ]),
    );
    expect(document.materials.length).toBeGreaterThanOrEqual(5);
    expect(document.lights).toHaveLength(2);
    expect(`${document.metadata.sourceRefs.join(" ")} ${document.metadata.warnings.join(" ")}`).toMatch(
      /synthetic|синтетическ/i,
    );
    expect(document.metadata.warnings.join(" ")).toMatch(/не является evidence KORA/i);
  });

  it("feeds SVG and Three adapters from one derivation of the canonical document", () => {
    const document = fixture();
    const derived = deriveLayout(document);
    const svg = createSvgProjection(derived);
    const three = compileSceneDescriptor(derived.sceneProjection);
    const requiredIds = [
      "wall.synthetic-liquid-station.north",
      "opening.synthetic-liquid-station.entry-door",
      "column.synthetic-liquid-station.structural",
      "object.synthetic-liquid-station.front-counter",
      "object.synthetic-liquid-station.central-double-sink",
    ];
    const svgIds = Object.values(svg)
      .filter(Array.isArray)
      .flatMap((entities) => entities as Array<{ sourceId?: string }>)
      .flatMap((entity) => entity.sourceId ? [entity.sourceId] : []);
    const threeIds = three.objects.map((entity) => entity.sourceId);

    expect(svg.units).toBe("mm");
    expect(three.units).toBe("m");
    expect(svgIds).toEqual(expect.arrayContaining(requiredIds));
    expect(threeIds).toEqual(expect.arrayContaining(requiredIds));
  });

  it("keeps the feature flag strictly default-off", () => {
    const source = read("lib/layout-studio/feature-flag.ts");

    expect(source).toMatch(/ARCHIDOM_LAYOUT_STUDIO_ENABLED/);
    expect(source).toMatch(/===\s*["']true["']/);
    expect(source).not.toMatch(/Boolean\s*\(|!!\s*(?:process\.env|value)|!==\s*["']false["']/);
  });

  it("provides the route, shell and centralized Russian UI copy", () => {
    const requiredFiles = [
      "app/dashboard/projects/[id]/layouts/[documentId]/page.tsx",
      "components/layout-studio/layout-studio-shell.tsx",
      "lib/layout-studio/feature-flag.ts",
      "lib/i18n/ru.ts",
    ] as const;
    const [routePath, shellPath, , copyPath] = requiredFiles;

    expect(requiredFiles.filter((path) => !existsSync(join(repoRoot, path)))).toEqual([]);

    const route = read(routePath);
    const shell = read(shellPath);
    const copy = read(copyPath);
    const uiContract = `${route}\n${shell}\n${copy}`;

    expect(route).toMatch(/export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/);
    expect(route).toMatch(/isLayoutStudioEnabled/);
    expect(route).toMatch(/layout-studio-shell/i);
    expect(uiContract).toMatch(/(?:^|[^\p{L}])2D(?:[^\p{L}]|$)/u);
    expect(uiContract).toMatch(/(?:^|[^\p{L}])3D(?:[^\p{L}]|$)/u);
    expect(uiContract).toMatch(/Редактор/i);
    expect(uiContract).toMatch(/Верси(?:я|и)/i);
    expect(uiContract).toMatch(/Экспорт/i);
    // Дисклеймер данных: в кабинете редактируется рабочий черновик реального
    // проекта (эпоха «синтетического preview» закончилась вместе с
    // демо-страницами), и он обязан честно говорить, чем НЕ является.
    expect(uiContract).toMatch(/рабочий черновик/i);
    expect(uiContract).toMatch(/не является[\s\S]{0,120}документаци/i);
  });

  it("keeps the pure domain free of React, Next, Three and Supabase dependencies", () => {
    const domainRoot = join(repoRoot, "lib/layout-studio/domain");
    const violations = sourceFiles(domainRoot).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const specifiers = [...source.matchAll(/(?:from\s+|import\s*\(|require\s*\()["']([^"']+)["']/g)]
        .flatMap((match) => match[1] ? [match[1]] : []);
      return specifiers
        .filter((specifier) => /^(?:react(?:\/|$)|next(?:\/|$)|three(?:\/|$)|@supabase\/|@\/components\/|@\/app\/)/.test(specifier))
        .map((specifier) => `${path}: ${specifier}`);
    });

    expect(violations).toEqual([]);
  });

  // До 08.08.2026 модуль работал целиком в браузере, и здесь стояла проверка
  // «Layout Studio не добавляет миграций вообще». С появлением серверного
  // хранения она устарела: миграция есть. Инвариант, который реально важен и
  // который эту проверку заменяет, — миграция АДДИТИВНА: ни один существующий
  // файл не удалён и не переименован. Именно это делало опасной ветку-источник
  // codex/archidom-layout-studio-m2, которая удаляла 0001_init…0006_team.
  it("adds migrations only additively: no pre-existing migration disappears", () => {
    const preExisting = [
      "20260716071024_legacy_production_baseline.sql",
      "20260716072000_project_intelligence_core.sql",
      "20260716073000_project_intelligence_operations.sql",
      "20260717090000_projectceo_foundation_access.sql",
      "20260717091000_projectceo_foundation_ingestion_read.sql",
      "20260717092000_projectceo_foundation_integration_hardening.sql",
      "20260717100000_projectceo_product_brain_persistence.sql",
      "20260717101000_projectceo_product_brain_operations.sql",
      "20260717101500_projectceo_product_brain_relational_hardening.sql",
      "20260717102000_projectceo_m4_execution_persistence.sql",
      "20260717103000_projectceo_m4_execution_operations.sql",
      "20260718124958_projectceo_ap1_authenticated_reads.sql",
      "20260718223000_projectceo_ap1_inventory_duplicate_groups.sql",
      "20260718225000_projectceo_ap1_legacy_metadata_bridge.sql",
      "20260801120000_projectceo_request_claim_authorization.sql",
      "20260801130000_projectceo_request_claim_sub_fallback.sql",
      "20260801150000_projectceo_custom_access_token_hook.sql",
      "20260802001000_projectceo_custom_access_token_hook_strict_method.sql",
      "20260802010000_projectceo_approval_self_approval.sql",
      "20260802020000_projectceo_approval_read_self_approval.sql",
      "20260802030000_projectceo_m2_workspace_revisions.sql",
      "20260802040000_projectceo_m2_workspace_read_projection.sql",
      "20260802050000_projectceo_m2_constraint_compatibility.sql",
      "20260802060000_projectceo_m2_read_package_scope_fix.sql",
      "20260802070000_projectceo_m2_approved_commits.sql",
      "20260802080000_projectceo_m2_layout_versions.sql",
      "20260802090000_projectceo_m2_client_review_m3_handoff.sql",
      "20260803010000_projectceo_source_materializations_fk_index.sql",
      // Модуль 3 «Документация» — влит в main PR #72 и для этой ветки является
      // ровно таким же pre-existing, как остальной контур projectceo.
      "20260810010000_projectceo_m3_documentation_persistence.sql",
      "20260810020000_projectceo_m3_documentation_read.sql",
      // Продолжение auth-фикса 20260801120000: переписывает тела пяти функций
      // M2/M3 на request-claim. К Layout Studio отношения не имеет.
      "20260810040000_projectceo_m2_m3_request_claim_followup.sql",
      // Дверь ревью источника в отданной схеме (projectceo_api.review_source) —
      // починка дефекта, найденного гейтом AP5. К Layout Studio отношения не
      // имеет.
      "20260810050000_projectceo_source_review_door.sql",
      // Чтение v8: ревизия для ревью не предлагается, пока её нет в графе
      // утверждений. Тоже находка гейта AP5, к Layout Studio не относится.
      "20260810060000_projectceo_source_review_target_requires_graph.sql",
      // Guardrail модуля 4: отзыв прав на командные RPC у authenticated.
      // К Layout Studio отношения не имеет.
      "20260810070000_projectceo_m4_execution_guardrail.sql",
      // Дверь публикации версии графа — предпосылка выхода M3.
      // К Layout Studio отношения не имеет.
      "20260810080000_projectceo_publish_version_door.sql",
      // Состав опубликованного baseline в чтении v9 — предпосылка выпуска
      // версии пакета. К Layout Studio отношения не имеет.
      "20260810090000_projectceo_baseline_refs_read.sql",
      // Guardrail модуля 3: отзыв прав на публикацию у authenticated.
      // К Layout Studio отношения не имеет.
      "20260811010000_projectceo_m3_publication_guardrail.sql",
      // Guardrail модуля 4, вторая половина: командные RPC выдачи и
      // подтверждения получения живут в продуктовой схеме, и сплошной отзыв по
      // схеме M4 их не касался. К Layout Studio отношения не имеет.
      "20260811020000_projectceo_m4_distribution_guardrail.sql",
      // Системное чтение очереди артефактов выпуска — единственная новая
      // поверхность воркерного этапа (DEC-030), права только у service role.
      // К Layout Studio отношения не имеет.
      "20260811030000_projectceo_release_artifact_worker_read.sql",
      // Фундамент Telegram Chat Bridge (A7/DEC-031): собственная приватная
      // схема, RLS deny-by-default. К Layout Studio отношения не имеет.
      "20260811040000_remhaos_channel_bridge_foundation.sql",
      "20260811050000_remhaos_channel_bridge_operations.sql",
      // Вертикаль Telegram → Project Inbox (A7 §1.8). К Layout Studio
      // отношения не имеет.
      "20260811060000_remhaos_channel_bridge_inbox.sql",
      // Исправление фундамента моста (CORRECTIVE GO 11.08.2026): один чат —
      // один проект, приём после уведомления, аренда очереди с fencing.
      // К Layout Studio отношения не имеет.
      "20260811070000_remhaos_channel_bridge_correction.sql",
      // V1 Impact модуля 4: очередь воркера расчёта влияния и политика обхода
      // (DEC-032, OWNER M4 IMPLEMENTATION GO на V1). Права только у
      // `service_role`. К Layout Studio отношения не имеет.
      "20260812010000_projectceo_m4_impact_worker_read.sql",
      // Усечение расчёта влияния становится данными вместо отказа (решение
      // владельца 12.08.2026). К Layout Studio отношения не имеет.
      "20260812020000_projectceo_m4_impact_truncation.sql",
      // Производственный выключатель вертикали V1 Impact (DEC-033): журнал
      // переключений и операции открыть/закрыть с обязательными подписью и
      // основанием. Применение миграции ничего не открывает. К Layout Studio
      // отношения не имеет.
      "20260812030000_projectceo_m4_v1_production_switch.sql",
      // DEC-034 (OWNER CONTINUE 12.08.2026): аддитивная коррекция контракта
      // покрытия V1 Impact поверх PR #94 — blocked_result_limit больше не
      // сохраняет найденное, acknowledge_impact_truncation закрыта навсегда.
      // К Layout Studio отношения не имеет.
      "20260813010000_projectceo_m4_v1_impact_dec034_correction.sql",
      // OWNER REVIEW 12.08.2026 (поверх DEC-034): аддитивная коррекция
      // maxDepth — 8 в 20260812010000 было числовой ошибкой переноса
      // исходного OWNER GO (7), а не переоткрытием вопроса. К Layout Studio
      // отношения не имеет.
      "20260813020000_projectceo_m4_v1_impact_policy_v2.sql",
      // OWNER REVIEW 12.08.2026 (поверх DEC-034/DEC-035): аддитивный
      // durable-failure/DLQ/redrive контур воркера расчёта влияния. К Layout
      // Studio отношения не имеет.
      "20260813030000_projectceo_m4_v1_impact_worker_reliability.sql",
      // Function-level statement_timeout двери публикации версии графа:
      // публикация baseline на графе >5000 узлов не помещалась в ролевые 8s.
      // К Layout Studio отношения не имеет.
      "20260813040000_projectceo_publish_version_timeout.sql",
      "20260817010000_projectceo_m4_v1_impact_recovery_dec037.sql",
      // Фаза 3a (24.08.2026): авторитетный DB-state включения модулей M3 и
      // M4-инкремент-1 — журнал переключений, open/close, is_module_open.
      // К Layout Studio отношения не имеет.
      "20260824150000_projectceo_platform_module_switch.sql",
      // Фаза 3a: read-only проекция released archive (M3 backlog #4).
      // К Layout Studio отношения не имеет.
      "20260824160000_projectceo_released_archive_read.sql",
      // Фаза 3a: атомарная дверь публикации baseline (M3 backlog #6/#7),
      // composition выводится сервером. К Layout Studio отношения не имеет.
      "20260824170000_projectceo_publish_baseline_door.sql",
      // Фаза 3a: воркерный контур ingest_source_graph (M3 backlog #5) —
      // очередь, системная дверь, durable-отказы DEC-036. К Layout Studio
      // отношения не имеет.
      "20260824180000_projectceo_source_ingest_worker.sql",
      // Фаза 3a: гейт читающих RPC по состоянию модуля M3 (backlog #2).
      // К Layout Studio отношения не имеет.
      "20260824190000_projectceo_m3_read_gate.sql",
      // Фаза 3a: вывод legacy-дверей выдачи/подтверждения из строя
      // (M4 backlog #2). К Layout Studio отношения не имеет.
      "20260824200000_projectceo_m4_retire_legacy_release_doors.sql",
      // Фаза 3a: v10 чтения — approvalSupersededEntities (M4 backlog #5).
      // К Layout Studio отношения не имеет.
      "20260824210000_projectceo_workspace_read_v10_superseded_approvals.sql",
    ];
    const actual = readdirSync(join(repoRoot, "supabase/migrations"), { withFileTypes: true })
      // Предмет проверки — миграции, а не всё содержимое папки. Рядом с ними
      // с 24.08.2026 лежит README.md о двух путях bootstrap; он не миграция и
      // в список Layout Studio попадать не должен.
      .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
      .map((entry) => basename(entry.name))
      .sort();

    for (const name of preExisting) {
      expect(actual, `миграция ${name} исчезла — историю схемы переписывать нельзя`)
        .toContain(name);
    }

    // Полный список миграций самого Layout Studio. Любая другая новая —
    // чужая, и тогда обновляется список preExisting, а не этот.
    const added = actual.filter((name) => !preExisting.includes(name));
    expect(added).toEqual([
      "20260808050000_layout_studio_drafts.sql",
      "20260808060000_layout_studio_workspace_binding.sql",
      // Контракт документа 0.2: валидатор публикации принимает обе версии,
      // каждую по её правилам (см. миграцию и db4/36).
      "20260810030000_projectceo_m2_layout_document_v02.sql",
      // DEC-038/Фаза 1: hosted GoTrue не кладёт email_verified в JWT при
      // password-логине; хук ставит claim из правды базы
      // (REMHAOS_AP1_PILOT_EVIDENCE_2026-08-24.md, FIND-01).
      "20260824120000_projectceo_auth_hook_email_verified_password.sql",
      // Фаза 2, A1 (DEC-038): платформенный реестр фактов с провенансом.
      "20260824130000_projectceo_platform_facts.sql",
      // Фаза 2, A2 (DEC-009): учёт вызовов AI без текстов промптов.
      "20260824140000_projectceo_platform_ai_calls.sql",
    ]);
  });

  it("keeps the layout migration on this chain's production RLS pattern", () => {
    // В ЭТОЙ цепочке миграций (legacy_production_baseline) продакшен-помощник —
    // public.is_studio_member(owner, auth.uid()): SECURITY DEFINER, ACL сохранён
    // базлайном сознательно, все политики answers/risk_cards/proposals ходят
    // через него. В ветке-источнике движка помощник был другим
    // (private.is_studio_member после 0008_platform_security_hardening), но той
    // цепочки на main нет — слепое копирование её шаблона дало бы обращение к
    // несуществующей схеме. Проверка пинит фактический контракт main.
    const raw = readFileSync(
      join(repoRoot, "supabase/migrations/20260808050000_layout_studio_drafts.sql"),
      "utf8",
    );
    // Сверяем исполняемый SQL, а не комментарии: комментарий вправе упоминать
    // альтернативы, которые здесь НЕ используются.
    const sql = raw.replace(/--[^\n]*/g, "");

    expect(sql).not.toMatch(/private\.is_studio_member\s*\(/);
    expect(sql).toMatch(/public\.is_studio_member\s*\(\s*p\.designer_id\s*,\s*auth\.uid\(\)\s*\)/);

    for (const table of ["layout_documents", "layout_checkpoints"]) {
      expect(sql, `${table}: RLS не включён`)
        .toContain(`alter table public.${table} enable row level security`);
      expect(sql, `${table}: политика не ограничена ролью authenticated`)
        .toMatch(new RegExp(`on public\\.${table}\\s+for all to authenticated`));
    }

    // Чекпойнт неизменяем на уровне БД, а не только приложения.
    expect(sql).toMatch(/before update on public\.layout_checkpoints/);
    // Таблицы версий в этой миграции нет: версии живут в projectceo_product.
    expect(sql).not.toMatch(/create table[^;]*layout_versions/);
  });
});
