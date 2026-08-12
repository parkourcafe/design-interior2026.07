import { createHash, randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext, type Browser } from "@playwright/test";

import { projectCeoCommandSchema } from "../../lib/project-intelligence/delivery/projectceo/command-contract";

import {
  ap5Env,
  readHandoff,
  storageStatePath,
  AP5_DECISION_NODE_ID,
  AP5_DECISION_REVISION_ID,
  AP5_DECISION_REVISION_ID_2,
  AP5_SOURCE_NAME,
  AP5_SOURCE_REVISION_ID,
  type Ap5RoleKey,
} from "./ap5-env";
import { runReleaseArtifactWorker } from "./release-worker";
import { runChangeImpactWorker } from "./change-impact-worker";

const env = ap5Env();
// Ленивое чтение: сборка списка тестов не должна зависеть от того,
// отработал ли global-setup — иначе `playwright test --list` падает.
let cached: ReturnType<typeof readHandoff> | null = null;
function handoff() {
  cached ??= readHandoff();
  return cached;
}

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
  const envelope = {
    contractVersion: "projectceo-command/0.1",
    kind,
    projectId: handoff().projectId,
    commandId: randomUUID(),
    payload,
  };
  // Маршрут отклоняет несоответствие контракту как 400 validation_failed —
  // ровно тем же кодом, что и отказ RPC на живом стеке. В прогоне 156 это
  // стоило сессии: артефакт показывал 400 и не мог сказать, чей это отказ.
  // Здесь дефект харнесса называет себя сам и не выдаёт себя за отказ сервера.
  const contract = projectCeoCommandSchema.safeParse(envelope);
  if (!contract.success) {
    throw new Error(
      `AP5: payload команды ${kind} нарушает контракт (дефект харнесса, не сервера): `
      + JSON.stringify(contract.error.issues),
    );
  }

  const response = await request.post("/api/projectceo/commands", {
    headers: { Origin: env.appUrl, "Content-Type": "application/json" },
    data: envelope,
  });
  return { status: response.status(), body: await response.json() };
}

type Workspace = {
  readonly sources: readonly {
    readonly id: string;
    readonly sourceRevisionId: string | null;
    readonly reviewTargetRevisionId: string | null;
    readonly reviewStatus: string;
  }[];
  readonly decisions: readonly { readonly revisionId: string; readonly claimStatus: string }[];
  readonly selections: readonly { readonly id: string; readonly decisionRevisionId: string }[];
  readonly releases: readonly {
    readonly id: string;
    readonly versionNo: number;
    readonly distributionStatus: string;
    readonly pendingDistributionId: string | null;
    readonly acknowledgementCount: number;
    readonly recipientCount: number;
  }[];
  readonly changes: readonly {
    readonly id: string;
    readonly reason: string;
    readonly impactCount: number;
    readonly reviewedImpactCount: number;
    readonly coverage: {
      readonly coverageStatus: "complete" | "partial_depth" | "blocked_result_limit";
      readonly hasMoreBeyondDepth: boolean;
      readonly returnedImpactCount: number;
      readonly knownImpactCountLowerBound: number;
      readonly allReturnedImpactsReviewed: boolean;
      readonly coverageComplete: boolean;
      readonly impactReviewComplete: boolean;
    } | null;
    readonly impacts: readonly {
      readonly impactRunId: string;
      readonly impactId: string;
      readonly label: string;
      readonly disposition: string | null;
    }[];
  }[];
  readonly participants: readonly { readonly role: string }[];
  readonly operations: Record<string, {
    readonly status?: string;
    readonly reason?: string;
    readonly commandTargetId?: string;
  }>;
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
   * Звено, на котором гейт нашёл ДВА дефекта, сложенных друг на друга.
   *
   * Первый — граница схем. Решение пишет
   * `project_intelligence_api.review_claim`, а эта схема намеренно не отдана
   * Data API (`supabase/config.toml`; `verify-runtime.mjs` требует от неё 406).
   * Вызов не находился PostgREST, ошибка не ложилась ни на один SQLSTATE и
   * выходила наружу как 500. Починено дверью `projectceo_api.review_source`
   * (миграция `20260810050000`), и её поведение проверяет DB4-сценарий
   * `tests/db4/37_source_review_door.sql`.
   *
   * Второй дефект был этим 500 закрыт и обнажился, когда дверь появилась:
   * прогон стал отвечать 409 `stale_state`. Источник, заведённый человеком,
   * попадает в инвентарь, но узлы графа утверждений создаёт воркерный
   * `ingest_source_graph`. Чтение при этом отдавало `reviewTargetRevisionId`
   * прямо из инвентаря — то есть поверхность предлагала отрецензировать
   * ревизию, которой в графе нет, и `review_claim` честно отвечал
   * `P1004 REVISION_STALE` с `currentRevisionId: null`.
   *
   * Починка — чтение v8 (`20260810060000`): цель ревью существует только тогда,
   * когда ревизия есть в графе. Значит из браузера сегодня проверяется не
   * успешное ревью (для него нужен воркерный ingest, см. «Чего он не
   * доказывает»), а то, что поверхность больше не обещает невозможного.
   */
  test("4. ревью источника не предлагается, пока ревизии нет в графе", async ({ browser }) => {
    const architect = await requestAs(browser, "designer");
    const view = await workspace(architect);
    const source = view.sources.at(0);
    expect(source?.sourceRevisionId).toBeTruthy();

    // Источник в инвентаре есть, а ревизии в графе нет — цели для ревью тоже
    // нет. Это и есть починка: раньше здесь лежал идентификатор из инвентаря.
    expect(source?.reviewTargetRevisionId).toBeNull();
    expect(view.operations.review_source?.status).toBe("unavailable");
    expect(view.operations.review_source?.reason).toBe("prerequisite_missing");

    // Если команду всё же послать в обход интерфейса — контролируемый отказ,
    // а не 500 и не 409 из глубины базы.
    const result = await command(architect, "review_source", {
      targetRevisionId: AP5_SOURCE_REVISION_ID,
      expectedRevisionId: AP5_SOURCE_REVISION_ID,
      decision: "confirmed",
    });
    expect(result.status, JSON.stringify(result.body.error)).toBe(404);
    expect(result.body.error?.code).toBe("not_found");
  });

  test("5. решение человеческого происхождения", async ({ browser }) => {
    const architect = await requestAs(browser, "designer");
    const decisionRevisionId = AP5_DECISION_REVISION_ID;

    const decision = await command(architect, "create_decision", {
      packageId: handoff().rootPackageId,
      nodeId: AP5_DECISION_NODE_ID,
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
   * Гейт 1 из A6 §6.1, первая половина: выход M3 через браузер.
   *
   * Всё, на что она опирается, собрано в этой сессии: дверь версии графа
   * (`20260810080000`), правило полноты, снапшот-токен и оркестровка в
   * команде. Клиент присылает только токен — состав выводит сервер.
   */
  test("6. выпуск версии: одобрение и публикация baseline из браузера", async ({ browser }) => {
    const architect = await requestAs(browser, "designer");
    const approvalPackageId = `ap5-approval-${randomUUID()}`;

    const created = await command(architect, "create_approval_package", {
      packageId: handoff().rootPackageId,
      approvalPackageId,
      items: [{
        targetKind: "decision_revision",
        entityId: AP5_DECISION_NODE_ID,
        revisionId: AP5_DECISION_REVISION_ID,
      }],
    });
    expect(created.status, JSON.stringify(created.body.error)).toBe(200);

    const submitted = await command(architect, "submit_approval_package", {
      approvalPackageId,
      expectedStatus: "draft",
    });
    expect(submitted.status, JSON.stringify(submitted.body.error)).toBe(200);

    const approved = await command(architect, "review_selection", {
      approvalPackageId,
      expectedStatus: "submitted",
      decision: "approved",
      reason: "AP5 authenticated browser chain",
    });
    expect(approved.status, JSON.stringify(approved.body.error)).toBe(200);

    // Поверхность обязана предложить публикацию и выдать токен: именно его
    // команда потребует назад, и именно он ловит гонку.
    const view = await workspace(architect);
    expect(view.operations.publish_baseline?.status).toBe("available");
    const snapshotToken = view.operations.publish_baseline?.commandTargetId;
    expect(snapshotToken).toBeTruthy();

    const published = await command(architect, "publish_baseline", { snapshotToken });
    expect(published.status, JSON.stringify(published.body.error)).toBe(200);

    // Устаревший токен обязан быть отвергнут, а не опубликован повторно:
    // после публикации состояние сдвинулось.
    const stale = await command(architect, "publish_baseline", { snapshotToken });
    expect(stale.status, JSON.stringify(stale.body.error)).toBe(409);
  });

  /**
   * Гейт 1 из A6 §6.1, вторая половина: выпуск производственного пакета через
   * браузер. Раньше здесь стоял `fixme` — контракт требовал от клиента полный
   * дескриптор с собственным `semanticHash`, а собрать его из браузера было
   * нечем. Лечение то же, что у baseline: состав выводит сервер из
   * опубликованного baseline (чтение v9), клиент возвращает снапшот-токен.
   */
  test("7. выпуск пакета: производственная версия от baseline из браузера", async ({ browser }) => {
    const architect = await requestAs(browser, "designer");

    // Поверхность обязана предложить выпуск и выдать токен — тот же контракт,
    // что и у baseline: без токена нажимать нечего.
    const view = await workspace(architect);
    expect(view.operations.publish_release?.status).toBe("available");
    const snapshotToken = view.operations.publish_release?.commandTargetId;
    expect(snapshotToken).toBeTruthy();

    const published = await command(architect, "publish_release", { snapshotToken });
    expect(published.status, JSON.stringify(published.body.error)).toBe(200);

    // Повтор тем же токеном обязан быть отвергнут: версия сдвинула состояние,
    // и второй выпуск выражал бы уже не то, что показывали.
    const stale = await command(architect, "publish_release", { snapshotToken });
    expect(stale.status, JSON.stringify(stale.body.error)).toBe(409);
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

  /**
   * Ожидание менялось вместе с продуктом дважды, и оба раза это ловил прогон.
   *
   * До guardrail'а M4 `build_handover` был закрыт одной причиной — операция
   * воркерная (`worker_only`). С 10.08 модуль закрыт флагом целиком, и причиной
   * стал `module_disabled`. С 11.08 модуль в этом прогоне ВКЛЮЧЁН: гейт 1
   * пройден, A6 §6.3 разрешает интерфейс инкремента 1, и доказать его иначе,
   * чем при включённом модуле, нельзя.
   *
   * Отсюда третья редакция ожидания. Инкремент 2 закрыт не флагом — его не
   * авторизовал ни один подписанный документ (A6 §1.1), — и причина обязана
   * называть именно это. Сказать `module_disabled` при включённом модуле
   * значило бы соврать о состоянии системы.
   */
  test("8. модуль включён, но V2/V3 закрыты — и названы своей причиной", async ({ browser }) => {
    const owner = await requestAs(browser, "owner");
    const operations = (await workspace(owner)).operations;

    // `review_change_impact` сюда больше не входит: DEC-033 (OWNER GO
    // 12.08.2026) авторизовал его как V1 поверх A6 §1.1 — см. звено 12.
    for (const kind of [
      "upload_photo_evidence",
      "review_photo_evidence",
      "accept_milestone",
      "build_handover",
    ]) {
      expect(operations[kind]?.status, kind).toBe("unavailable");
      expect(operations[kind]?.reason, kind).toBe("increment_not_authorized");
    }

    // Поверхность — половина запрета. Вторая половина в том, что команда,
    // посланная в обход интерфейса, отклоняется сервером до единого чтения и
    // записи, а не доходит до RPC и не получает отказ по правам.
    const denied = await command(owner, "accept_milestone", {
      milestoneId: "a5d0c1c1-0000-4000-8000-00000000dead",
    });
    expect(denied.status, JSON.stringify(denied.body.error)).toBe(409);
    expect(denied.body.error?.code).toBe("operation_unavailable");
  });

  /**
   * Гейт 2 из A6 §6.1, звено 1: выдача выпущенного пакета.
   *
   * Здесь же — находка гейта, которую стоит назвать прямо. A6 §1.1 утверждает,
   * что у инкремента 1 нет воркерных предпосылок. Для выдачи это неверно:
   * `distribute_release` адресуется артефакту выпуска, а собрать артефакт может
   * только система (`build_release_artifact`, права только у service_role,
   * автор записи — `system:projectceo-product-worker`). Человеческой двери к
   * ней нет.
   *
   * С 11.08 (DEC-030) этот шаг делает НАСТОЯЩИЙ воркер, а не psql-мост, который
   * его изображал: `npm run worker:release-artifacts`. Очередь воркер находит
   * сам — ни версии, ни идентификатора артефакта ему тут не передают, иначе
   * недоказанным осталось бы ровно то, ради чего он написан. Сама выдача идёт
   * через браузер сессией владельца.
   */
  test("9. выдача пакета получателю из браузера", async ({ browser }) => {
    const owner = await requestAs(browser, "owner");
    const release = (await workspace(owner)).releases.at(0);
    expect(release?.id, "выпуск шага 7 обязан быть виден в проекции").toBeTruthy();

    // До воркера поверхность честно отвечала `prerequisite_missing`.
    const beforeWorker = await workspace(owner);
    expect(beforeWorker.operations.distribute_release?.status).toBe("unavailable");
    expect(beforeWorker.operations.distribute_release?.reason).toBe("prerequisite_missing");

    const worker = runReleaseArtifactWorker();
    expect(worker.created, JSON.stringify(worker)).toBeGreaterThan(0);

    // Повтор — no-op: очередь пуста, второго артефакта не появляется. Это то
    // же свойство, что DB4 проверяет на гонке, но здесь оно проверено на живом
    // стеке настоящим процессом.
    const repeat = runReleaseArtifactWorker();
    expect(repeat.created, JSON.stringify(repeat)).toBe(0);
    expect(repeat.scanned, JSON.stringify(repeat)).toBe(0);

    // Только теперь поверхность имеет право предлагать выдачу.
    const view = await workspace(owner);
    expect(view.operations.distribute_release?.status).toBe("available");
    expect(view.operations.distribute_release?.commandTargetId).toBe(release!.id);

    const recipientUserId = handoff().userIds.builder;
    expect(recipientUserId).toBeTruthy();

    const distributed = await command(owner, "distribute_release", {
      productionPackageVersionId: release!.id,
      recipientUserId,
    });
    expect(distributed.status, JSON.stringify(distributed.body.error)).toBe(200);

    const after = (await workspace(owner)).releases.at(0);
    expect(after?.recipientCount).toBeGreaterThan(0);
  });

  /**
   * Гейт 2, звено 2: подтверждение получения — СЕССИЕЙ ПОЛУЧАТЕЛЯ.
   *
   * A6 §6.1 требует именно этого и объясняет почему: право
   * `acknowledge_release` есть и у `owner_lead`, и у `architect`, так что
   * подтвердить «за строителя» технически возможно, и доказательство,
   * собранное чужой сессией, не стоило бы ничего.
   */
  test("10. подтверждение получения сессией получателя, а не отправителя", async ({ browser }) => {
    const builder = await requestAs(browser, "builder");
    const view = await workspace(builder);
    expect(view.operations.acknowledge_release?.status).toBe("available");
    const distributionId = view.operations.acknowledge_release?.commandTargetId;
    expect(distributionId).toBeTruthy();

    // Отправитель получателем не является, и его поверхность это признаёт:
    // выдача не создаёт ему собственного получения.
    const owner = await requestAs(browser, "owner");
    const ownerView = await workspace(owner);
    expect(ownerView.operations.acknowledge_release?.status).toBe("unavailable");
    expect(ownerView.operations.acknowledge_release?.reason).toBe("prerequisite_missing");

    const acknowledged = await command(builder, "acknowledge_release", { distributionId });
    expect(acknowledged.status, JSON.stringify(acknowledged.body.error)).toBe(200);

    const release = (await workspace(builder)).releases.at(0);
    expect(release?.acknowledgementCount).toBeGreaterThan(0);
  });

  /**
   * Гейт 2, звено 3: заявка на изменение.
   *
   * Предпосылка заявки — расхождение: выпущенная версия пакета собрана по
   * baseline, который больше не последний, И новый baseline обязан ОТЛИЧАТЬСЯ.
   * `submit_change_request` строит корни изменения из пар «одна сущность,
   * разные ревизии» и без единого корня отвечает `NO_CHANGE_ROOTS`. Поэтому
   * шаг не просто публикует baseline второй раз, а проводит настоящий
   * пересмотр: новая ревизия решения → новый approval package → одобрение →
   * baseline V2.
   *
   * Прогон 193 нашёл здесь дефект сборщика состава, из-за которого этот путь
   * не работал вовсе: baseline замораживал ВСЕ одобренные ревизии, включая
   * заменённые, и база отвергала дескриптор
   * (`BASELINE_REVISION_NOT_IN_GRAPH_VERSION`). Починка — «одна ревизия на
   * сущность, побеждает поздняя» (`baseline-composition.ts`).
   */
  test("11. заявка на изменение от строителя по устаревшей редакции", async ({ browser }) => {
    const architect = await requestAs(browser, "designer");

    // Пересмотр решения: тот же узел, новая ревизия поверх прежней.
    const revised = await command(architect, "create_decision", {
      packageId: handoff().rootPackageId,
      nodeId: AP5_DECISION_NODE_ID,
      revisionId: AP5_DECISION_REVISION_ID_2,
      expectedRevisionId: AP5_DECISION_REVISION_ID,
      claimStatus: "human_origin",
      title: "AP5 decision (revised)",
      resolution: "AP5 chain decision revised from an authenticated architect session.",
      areaNodeId: null,
      decisionStatus: "confirmed",
      evidence: [],
      reason: "AP5 authenticated browser chain — revision for the change request",
    });
    expect(revised.status, JSON.stringify(revised.body.error)).toBe(200);

    const approvalPackageId = `ap5-approval-${randomUUID()}`;
    const created = await command(architect, "create_approval_package", {
      packageId: handoff().rootPackageId,
      approvalPackageId,
      items: [{
        targetKind: "decision_revision",
        entityId: AP5_DECISION_NODE_ID,
        revisionId: AP5_DECISION_REVISION_ID_2,
      }],
    });
    expect(created.status, JSON.stringify(created.body.error)).toBe(200);

    const submitted = await command(architect, "submit_approval_package", {
      approvalPackageId,
      expectedStatus: "draft",
    });
    expect(submitted.status, JSON.stringify(submitted.body.error)).toBe(200);

    const approved = await command(architect, "review_selection", {
      approvalPackageId,
      expectedStatus: "submitted",
      decision: "approved",
      reason: "AP5 authenticated browser chain",
    });
    expect(approved.status, JSON.stringify(approved.body.error)).toBe(200);

    const beforeSecondBaseline = await workspace(architect);
    expect(beforeSecondBaseline.operations.publish_baseline?.status).toBe("available");
    const snapshotToken = beforeSecondBaseline.operations.publish_baseline?.commandTargetId;
    expect(snapshotToken).toBeTruthy();

    const secondBaseline = await command(architect, "publish_baseline", { snapshotToken });
    expect(secondBaseline.status, JSON.stringify(secondBaseline.body.error)).toBe(200);

    const builder = await requestAs(browser, "builder");
    const view = await workspace(builder);
    expect(view.operations.create_change?.status).toBe("available");
    const fromProductionPackageVersionId = view.operations.create_change?.commandTargetId;
    expect(fromProductionPackageVersionId).toBeTruthy();

    const change = await command(builder, "create_change", {
      reason: "AP5: на объекте вскрылось расхождение с выпущенной редакцией",
      fromProductionPackageVersionId,
      deltaCostRub: 0,
      deltaDays: 0,
    });
    expect(change.status, JSON.stringify(change.body.error)).toBe(200);

    const changes = (await workspace(builder)).changes;
    expect(changes.length).toBeGreaterThan(0);
  });

  /**
   * Звено 12: V1 Impact (DEC-033, OWNER GO 12.08.2026). Владелец заявки —
   * builder (звено 11); расчёт влияния — воркерная операция без человеческой
   * двери. НАСТОЯЩИЙ системный воркер (не мост из спеки) сам находит заявку
   * через `list_change_impact_backlog` и считает влияние единственной
   * policy-bound дверью. АРХИТЕКТОР — ОТДЕЛЬНОЙ аутентифицированной сессией,
   * не той, что создавала заявку, — открывает результат и рассматривает
   * найденные влияния.
   */
  test("12. расчёт влияния настоящим воркером и ревью отдельной сессией архитектора", async ({ browser }) => {
    const builder = await requestAs(browser, "builder");
    const change = (await workspace(builder)).changes.at(-1);
    expect(change?.id, "заявка звена 11 обязана быть видна в проекции").toBeTruthy();

    // До воркера влияния ещё нет: ревью нечего рассматривать.
    expect(change?.coverage).toBeNull();
    expect(change?.impactCount).toBe(0);

    const worker = runChangeImpactWorker();
    expect(worker.calculated, JSON.stringify(worker)).toBeGreaterThan(0);

    // Повтор — no-op: очередь пуста, второго прогона на ту же заявку нет.
    // Одно изменение — один прогон влияния, воркер это уважает.
    const repeat = runChangeImpactWorker();
    expect(repeat.scanned, JSON.stringify(repeat)).toBe(0);

    // Архитектор — сессия, которая НЕ создавала заявку (это делал builder) и
    // не ходила service role ключом (это делал воркер, не браузерная сессия
    // вовсе). Именно так формулирует требование OWNER GO: результат открывает
    // отдельная аутентифицированная сессия.
    const architect = await requestAs(browser, "designer");
    const afterWorker = (await workspace(architect)).changes.find((entry) => entry.id === change!.id);
    expect(afterWorker?.coverage, JSON.stringify(afterWorker)).toBeTruthy();
    const coverage = afterWorker!.coverage!;

    // Золотой граф Kora мал: реалистичный исход здесь — complete, не
    // partial_depth/blocked_result_limit. Точные границы (5000/5001),
    // приоритет лимита над глубиной при совмещённом срабатывании и полная
    // матрица трёх исходов доказаны на управляемых фикстурах в DB5
    // (`tests/db5/27_impact_coverage_outcomes.sql`, PostgreSQL 16 и 17) —
    // строить там же синтетический граф вне бюджета глубины/лимита живым
    // человеческим командным контуром AP5 не может: узлы и рёбра графа
    // зависимостей приходят из импорта источников, а не из команд модуля 4.
    // Здесь проверяется, что РЕАЛЬНЫЙ воркер и РЕАЛЬНАЯ RPC на живом стеке
    // несут те же поля контракта, что и договорились, а разбор partial/
    // blocked поверх них — компонентный уровень
    // (`tests/projectceo-ui/workflows.test.ts`).
    expect(["complete", "partial_depth", "blocked_result_limit"]).toContain(coverage.coverageStatus);
    expect(afterWorker!.impacts.length).toBe(coverage.returnedImpactCount);

    if (coverage.coverageStatus === "blocked_result_limit") {
      // Показывать нечего — ни единой карточки, ни доступного действия ревью.
      expect(afterWorker!.impacts.length).toBe(0);
      const operations = (await workspace(architect)).operations;
      expect(operations.review_change_impact?.status).not.toBe("available");
      return;
    }

    expect(afterWorker!.impacts.length).toBeGreaterThan(0);

    // Ревью — та же сессия архитектора, что открыла результат. Проходим ВСЕ
    // показанные карточки — OWNER GO явно требует проверить именно это
    // состояние, не только «одна карточка просмотрена».
    let lastReview: Awaited<ReturnType<typeof command>> | null = null;
    for (const impact of afterWorker!.impacts) {
      lastReview = await command(architect, "review_change_impact", {
        impactRunId: impact.impactRunId,
        impactId: impact.impactId,
        disposition: "resolved",
        reason: "AP5: влияние проверено архитектором на живом стеке",
      });
      expect(lastReview.status, JSON.stringify(lastReview.body.error)).toBe(200);
    }
    expect(lastReview?.body.result?.allReturnedImpactsReviewed).toBe(true);

    if (coverage.coverageStatus === "complete") {
      // Все показанные карточки просмотрены, обход исчерпан — ревью влияния
      // действительно закончено.
      expect(lastReview?.body.result?.coverageComplete).toBe(true);
      expect(lastReview?.body.result?.impactReviewComplete).toBe(true);
    } else {
      // partial_depth: все показанные карточки просмотрены, но обход НЕ
      // исчерпан — DEC-033: рассмотреть найденное не значит «анализ завершён».
      expect(lastReview?.body.result?.coverageComplete).toBe(false);
      expect(lastReview?.body.result?.impactReviewComplete).toBe(false);
    }
  });

  /**
   * Звено 13: воркерные RPC V1 Impact недостижимы обычной аутентифицированной
   * сессией даже В ОБХОД приложения — прямым вызовом Data API живого проекта
   * тем же anon key, каким ходит браузер. Человеческой команды для расчёта не
   * существует вовсе (в контракте команд её нет); эта проверка — про границу
   * СЛЕДУЮЩЕГО уровня, саму базу живого проекта, а не про приложение поверх
   * неё (тот же протокол уже исчерпывающе доказан в DB5, здесь — тот же факт
   * на реальном, не одноразовом, проекте).
   */
  test("13. дверь расчёта недостижима напрямую через Data API живого проекта", async ({ playwright }) => {
    const direct = await playwright.request.newContext({ baseURL: env.supabaseUrl });
    try {
      const response = await direct.post("/rest/v1/rpc/calculate_change_impact_policy_bound", {
        headers: {
          apikey: env.anonKey,
          Authorization: `Bearer ${env.anonKey}`,
          "Content-Type": "application/json",
        },
        data: {
          project_id: handoff().projectId,
          change_request_id: "00000000-0000-4000-8000-000000000000",
          expected_state_revision: 1,
          idempotency_key: "ap5-direct-probe",
        },
      });
      expect([401, 403, 404]).toContain(response.status());
    } finally {
      await direct.dispose();
    }
  });
});

/**
 * Оставшиеся звенья цепочки AP5 из MASTER_EXECUTION_PLAN §AP5. Каждое помечено
 * причиной, а не молча пропущено: красный или пропущенный шаг здесь означает
 * «не доказано», и в отчёте гейта он виден именно так.
 */
test.describe("AP5 — ещё не покрытые звенья", () => {
  // Четыре звена ушли отсюда — 11.08 три первых, 12.08 (DEC-033, OWNER GO)
  // четвёртое, — и каждое потому, что доказано, а не потому что причина
  // перестала нравиться. Строка-пропуск на пройденном звене — это отчёт,
  // который врёт:
  //   * «Decision/Selection approval → ProjectBaseline V1» — шаг 6 (гейт 1);
  //   * «ProductionPackageVersion V1 → распространение и подтверждение» —
  //     шаги 7, 9 и 10 (гейт 1 и гейт 2);
  //   * заявка на изменение — шаг 11;
  //   * bounded impact и ревью человека по нему — шаги 12 и 13 (V1 Impact).
  test.fixme(
    "фотодоказательство и приёмка вехи",
    // upload_photo_evidence требует существующего milestoneId; вех в проекте
    // без воркерного плана нет.
    () => {},
  );
});
