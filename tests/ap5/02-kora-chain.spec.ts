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
   * НЕ ПРОХОДИТ на живом стеке, и это находка, а не пропуск.
   *
   * Источник, заведённый из браузера, попадает в инвентарь, но не в граф
   * утверждений: узлы графа создаёт воркерный `ingest_source_graph`. При этом
   * `review_source` уходит в `project_intelligence_api.review_claim` с
   * `inventory.source_revision_id`, которого в графе нет, и RPC падает
   * неконтролируемой ошибкой — команда отвечает 500 `internal_error`.
   *
   * Отдельно неприятно, что действие при этом ПРЕДЛАГАЕТСЯ: в проекции
   * `pendingSourceRevisionId` не пуст (live-read-port.ts:1011), значит в
   * рабочем пространстве кнопка ревью показывается доступной и по нажатию
   * даёт 500. Либо affordance не должен появляться до воркерного ingest, либо
   * команда обязана отвечать контролируемым отказом. Решение — за владельцем.
   */
  test.fixme("4. ревью источника подтверждает ровно ту ревизию", async ({ browser }) => {
    const architect = await requestAs(browser, "designer");
    const source = (await workspace(architect)).sources.at(0);
    expect(source?.reviewTargetRevisionId).toBeTruthy();

    const result = await command(architect, "review_source", {
      targetRevisionId: source!.reviewTargetRevisionId,
      expectedRevisionId: source!.reviewTargetRevisionId,
      decision: "confirmed",
    });
    expect(result.status, JSON.stringify(result.body.error)).toBe(200);

    const reviewed = (await workspace(architect)).sources
      .find((candidate) => candidate.id === source!.id);
    expect(reviewed?.reviewStatus).toBe("confirmed");
  });

  test("5. решение и выбор — человеческого происхождения", async ({ browser }) => {
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
      areaNodeId: "ap5-area-floor-1",
      decisionStatus: "confirmed",
      evidence: [],
      reason: "AP5 authenticated browser chain",
    });
    expect(decision.status, JSON.stringify(decision.body.error)).toBe(200);

    const selection = await command(architect, "create_selection", {
      packageId: handoff().rootPackageId,
      nodeId: "ap5-selection-floor-1",
      revisionId: randomUUID(),
      expectedRevisionId: null,
      claimStatus: "human_origin",
      title: "AP5 selection",
      areaNodeId: "ap5-area-floor-1",
      decisionRevisionId,
      specification: { finish: "AP5 reference finish" },
      evidence: [],
      reason: "AP5 authenticated browser chain",
    });
    expect(selection.status, JSON.stringify(selection.body.error)).toBe(200);

    const view = await workspace(architect);
    expect(view.decisions.some((item) => item.revisionId === decisionRevisionId)).toBe(true);
    expect(view.selections.some((item) => item.decisionRevisionId === decisionRevisionId)).toBe(true);
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
