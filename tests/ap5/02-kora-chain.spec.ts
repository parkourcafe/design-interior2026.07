import { createHash, randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext, type Browser } from "@playwright/test";

import { ap5Env, readHandoff, storageStatePath, type Ap5RoleKey } from "./ap5-env";

const env = ap5Env();
// Ленивое чтение: сборка списка тестов не должна зависеть от того,
// отработал ли global-setup — иначе `playwright test --list` падает.
let cached: ReturnType<typeof readHandoff> | null = null;
function handoff() {
  cached ??= readHandoff();
  return cached;
}

const AP5_SOURCE_NAME = "ap5-floor-1-zone-a-architectural";
const AP5_SOURCE_REVISION_ID = "ap5-source-revision-1";

// Цепочка идёт одним состоянием проекта: каждый шаг опирается на предыдущий.
test.describe.configure({ mode: "serial" });

async function requestAs(browser: Browser, role: Ap5RoleKey): Promise<APIRequestContext> {
  const context = await browser.newContext({
    baseURL: env.appUrl,
    storageState: storageStatePath(role),
  });
  return context.request;
}

type CommandResult = {
  readonly status: number;
  readonly body: {
    readonly status?: string;
    // Именно `result`, а не `data`: у командного конверта поля `data` нет,
    // оно есть только у читающих маршрутов.
    readonly result?: Record<string, unknown>;
    readonly error?: { readonly code?: string };
  };
};

async function command(
  request: APIRequestContext,
  kind: string,
  payload: Record<string, unknown>,
): Promise<CommandResult> {
  const response = await request.post("/api/projectceo/commands", {
    headers: { Origin: env.appUrl, "Content-Type": "application/json" },
    data: {
      contractVersion: "projectceo-command/0.1",
      kind,
      projectId: handoff().projectId,
      commandId: randomUUID(),
      payload,
    },
  });
  return { status: response.status(), body: await response.json() };
}

type Workspace = {
  readonly sources: readonly {
    readonly id: string;
    readonly reviewTargetRevisionId: string | null;
    readonly reviewStatus: string;
  }[];
  readonly decisions: readonly { readonly revisionId: string; readonly claimStatus: string }[];
  readonly selections: readonly { readonly id: string; readonly decisionRevisionId: string }[];
  readonly participants: readonly { readonly role: string }[];
  readonly operations: Record<string, { readonly status?: string; readonly reason?: string }>;
};

async function workspace(request: APIRequestContext): Promise<Workspace> {
  const response = await request.get(`/api/projectceo/projects/${handoff().projectId}`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  return body.data as Workspace;
}

test.describe("AP5 — цепочка Kora на живом стеке", () => {
  test("1. организация и проект зарегистрированы, корневой пакет существует", async ({ browser }) => {
    const owner = await requestAs(browser, "owner");
    const view = await workspace(owner);
    expect(view.participants.length).toBeGreaterThan(0);
  });

  test("2. приглашения приняты: три роли состоят в проекте", async ({ browser }) => {
    const owner = await requestAs(browser, "owner");
    const roles = (await workspace(owner)).participants.map((participant) => participant.role);
    // Роли приняты в браузере приглашёнными сессиями (global-setup), здесь
    // проверяется результат, а не повторяется действие.
    for (const expected of ["architect", "builder", "client"]) {
      expect(roles).toContain(expected);
    }
  });

  test("3. регистрация санитизированного источника", async ({ browser }) => {
    const architect = await requestAs(browser, "designer");
    // Запись материализованная, а не плейсхолдер. Читающая проекция берёт
    // `reviewTargetRevisionId` из `inventory.source_revision_id`
    // (20260718124958), а плейсхолдеру контракт нести ревизию запрещает — то
    // есть рецензировать в нём нечего по замыслу, и шаг 4 был бы невозможен.
    // Размер, контрольная сумма и ревизия — метаданные инвентаря, которые
    // команда и ожидает от клиента; объект в Storage они не утверждают.
    const result = await command(architect, "register_source", {
      packageId: handoff().rootPackageId,
      physicalRecordId: randomUUID(),
      sanitizedName: AP5_SOURCE_NAME,
      floorId: "floor-1",
      zoneId: "zone-a",
      disciplineId: "architectural",
      availability: "materialized",
      documentStatus: "current",
      sizeBytes: 1024,
      checksum: createHash("sha256").update(AP5_SOURCE_NAME).digest("hex"),
      sourceRevisionId: AP5_SOURCE_REVISION_ID,
    });
    expect(result.status, JSON.stringify(result.body.error)).toBe(200);
    expect(result.body.status).toBe("completed");

    const view = await workspace(architect);
    expect(view.sources.length).toBeGreaterThan(0);
  });

  /**
   * Звено закрыто — и закрыто честно, что и проверяется.
   *
   * Решение по источнику пишет `project_intelligence_api.review_claim`, а эта
   * схема намеренно не отдана Data API (`supabase/config.toml`;
   * `verify-runtime.mjs` требует от неё 406). Раньше поверхность действие
   * предлагала, вызов не находился PostgREST, и наружу выходил 500 — ровно это
   * гейт и поймал в прогоне 09:42. Теперь и affordance, и команда говорят
   * «недоступно», а 500 у пользователя больше нет.
   */
  test("4. ревью источника закрыто до тонкой RPC и не обещает лишнего", async ({ browser }) => {
    const architect = await requestAs(browser, "designer");
    const view = await workspace(architect);
    const source = view.sources.at(0);
    expect(source?.reviewTargetRevisionId).toBeTruthy();

    expect(view.operations.review_source?.status).toBe("unavailable");
    expect(view.operations.review_source?.reason).toBe("read_contract_pending");

    const result = await command(architect, "review_source", {
      targetRevisionId: source!.reviewTargetRevisionId,
      expectedRevisionId: source!.reviewTargetRevisionId,
      decision: "confirmed",
    });
    // Контролируемый отказ, а не 500: 409 operation_unavailable.
    expect(result.status, JSON.stringify(result.body.error)).toBe(409);
    expect(result.body.error?.code).toBe("operation_unavailable");
  });

  test("5. решение человеческого происхождения", async ({ browser }) => {
    const architect = await requestAs(browser, "designer");
    const decisionRevisionId = randomUUID();

    const decision = await command(architect, "create_decision", {
      packageId: handoff().rootPackageId,
      nodeId: "ap5-decision-floor-1",
      revisionId: decisionRevisionId,
      expectedRevisionId: null,
      // Только human_origin: ссылки на evidence рождаются в воркерном
      // ingest_source_graph, из браузера их предъявить нечем (command-contract.ts).
      claimStatus: "human_origin",
      title: "AP5 decision",
      resolution: "AP5 chain decision recorded from an authenticated architect session.",
      // Без привязки к площади: узлы `kind='area'` живут в
      // project_intelligence.graph_nodes и создаются не отсюда, а выдуманный
      // идентификатор RPC отвергает как AREA_NODE_INVALID (20260717101000:679).
      areaNodeId: null,
      decisionStatus: "confirmed",
      evidence: [],
      reason: "AP5 authenticated browser chain",
    });
    expect(decision.status, JSON.stringify(decision.body.error)).toBe(200);

    const view = await workspace(architect);
    expect(view.decisions.some((item) => item.revisionId === decisionRevisionId)).toBe(true);
  });

  /**
   * НЕ ПРОХОДИТ на живом стеке — звено требует воркера, как и остальные четыре.
   *
   * У решения `areaNodeId` допускает null, а у выбора он обязателен
   * (`command-contract.ts`) и обязан ссылаться на существующий узел
   * `kind='area'` в `project_intelligence.graph_nodes`. Такие узлы создаёт
   * ingest, а не браузерные команды: RPC решения заводит узел только для
   * собственного `nodeId` (20260717101000:661). Пока графа нет, выбор из
   * браузера создать нечем — и это ограничение продукта, а не харнесса.
   */
  test.fixme("5а. выбор привязан к площади, которой без ingest не существует", async ({ browser }) => {
    const architect = await requestAs(browser, "designer");
    const selection = await command(architect, "create_selection", {
      packageId: handoff().rootPackageId,
      nodeId: "ap5-selection-floor-1",
      revisionId: randomUUID(),
      expectedRevisionId: null,
      claimStatus: "human_origin",
      title: "AP5 selection",
      areaNodeId: "ap5-area-floor-1",
      decisionRevisionId: "ap5-decision-revision",
      specification: { finish: "AP5 reference finish" },
      evidence: [],
      reason: "AP5 authenticated browser chain",
    });
    expect(selection.status, JSON.stringify(selection.body.error)).toBe(200);
  });

  test("6. закрытие передачи остаётся воркерной операцией и честно об этом говорит", async ({ browser }) => {
    const owner = await requestAs(browser, "owner");
    const operations = (await workspace(owner)).operations;
    // Это не пропуск шага, а его результат: build_handover помечен worker_only
    // на сервере, и браузер не должен делать вид, что закрывает передачу.
    expect(operations.build_handover?.status).toBe("unavailable");
    expect(operations.build_handover?.reason).toBe("worker_only");
  });
});

/**
 * Оставшиеся звенья цепочки AP5 из MASTER_EXECUTION_PLAN §AP5. Каждое помечено
 * причиной, а не молча пропущено: красный или пропущенный шаг здесь означает
 * «не доказано», и в отчёте гейта он виден именно так.
 */
test.describe("AP5 — ещё не покрытые звенья", () => {
  test.fixme(
    "Decision/Selection approval → ProjectBaseline V1",
    // create_approval_package/submit_approval_package/review_selection/publish_baseline
    // подключены, но publish_baseline принимает дескриптор с семантическим
    // хешем, который собирает доменный слой; сборка дескриптора из браузера
    // не описана (AP1_RUNBOOK §4.1 — открытый вопрос владельца).
    () => {},
  );
  test.fixme(
    "ProductionPackageVersion V1 → распространение и подтверждение",
    // publish_release/distribute_release/acknowledge_release требуют
    // опубликованного baseline из предыдущего пункта.
    () => {},
  );
  test.fixme(
    "изменение с дельтой в рублях и днях → bounded impact и решения человека",
    // create_change проходит, но review_change_impact адресуется impactRunId,
    // который создаёт воркерный расчёт влияния.
    () => {},
  );
  test.fixme(
    "фотодоказательство и приёмка вехи",
    // upload_photo_evidence требует существующего milestoneId; вех в проекте
    // без воркерного плана нет.
    () => {},
  );
});
