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
  AP5_DEPENDENT_SOURCE_ID,
  AP5_SOURCE_NAME,
  AP5_SOURCE_REVISION_ID,
  type Ap5RoleKey,
} from "./ap5-env";
import { runReleaseArtifactWorker } from "./release-worker";
import { runChangeImpactWorker } from "./change-impact-worker";
import { ingestDependentNode } from "./dependent-node";

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
    // Влияние читается из того же вью, что видит человек: проверять его по
    // базе значило бы доказывать не то, что показано в интерфейсе.
    readonly impactCount: number;
    readonly reviewedImpactCount: number;
    readonly impactRunId: string | null;
    readonly impactTruncated: boolean;
    readonly impactReviewComplete: boolean;
    readonly impacts: readonly {
      readonly impactRunId: string;
      readonly impactId: string;
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
   * 5б. Узел, ЗАВИСЯЩИЙ от решения.
   *
   * Без него влияние изменения пусто по построению: обход идёт по обратным
   * рёбрам, а в цепочке от решения не зависел ни один узел. Шаг создаёт ровно
   * одно ребро `spec --depends_on--> decision` — минимум, дающий ровно одну
   * карточку.
   *
   * Стоит ДО публикации baseline намеренно: `publish_baseline` снимает версию
   * графа целиком, и ребро, добавленное после снимка, в целевую версию не
   * попадёт.
   *
   * Отступление, ограниченное собой: у `ingest_source_graph` нет HTTP-двери,
   * поэтому вызов идёт RPC — но ТОКЕНОМ архитектора, не service role (у неё
   * этой функции нет вовсе). См. `tests/ap5/dependent-node.ts`.
   */
  test("5б. в графе появляется узел, зависящий от решения", async () => {
    const ingested = await ingestDependentNode();
    expect(ingested.sourceId).toBe(AP5_DEPENDENT_SOURCE_ID);
    expect(ingested.ingestionId).toBeTruthy();
    // Что ребро действительно построено и действительно обратное, доказывает
    // шаг 12: без него прогон влияния снова получился бы пустым. Проверять это
    // здесь запросом в обход продукта значило бы доказывать не тот путь.
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
  test("8. модуль включён, но неавторизованное закрыто — и названо своей причиной", async ({ browser }) => {
    const owner = await requestAs(browser, "owner");
    const operations = (await workspace(owner)).operations;

    // Четыре команды вертикалей V2 и V3 не авторизованы ничем, и причина обязана
    // называть именно это, а не отсутствие предпосылок: предпосылки тут ни при
    // чём, их не открывал ни один документ.
    for (const kind of [
      "upload_photo_evidence",
      "review_photo_evidence",
      "accept_milestone",
      "build_handover",
    ]) {
      expect(operations[kind]?.status, kind).toBe("unavailable");
      expect(operations[kind]?.reason, kind).toBe("increment_not_authorized");
    }

    // А вот команды вертикали V1 с 12.08.2026 АВТОРИЗОВАНЫ, и их недоступность
    // здесь — другого рода: прогона влияния ещё нет (звено 12 его создаст).
    // Разница в причине и есть предмет проверки: назвать открытую команду
    // «неавторизованной» значило бы соврать о состоянии продукта ровно так же,
    // как назвать закрытую «недостающей предпосылкой».
    for (const kind of ["review_change_impact", "acknowledge_impact_truncation"]) {
      expect(operations[kind]?.status, kind).toBe("unavailable");
      expect(operations[kind]?.reason, kind).toBe("prerequisite_missing");
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
   * 12. Влияние изменения: заявка → системный расчёт → рассмотрение
   *     архитектором. Полная цепочка.
   *
   * Форма звена 9, но с человеком на обоих концах: изменение создаёт человек
   * браузером (шаг 11), влияние считает СИСТЕМА своим процессом, а разбирает
   * снова человек — архитектор своей сессией через публичный маршрут команд.
   *
   * Непустым прогон стал благодаря шагу 5б: ребро
   * `spec --depends_on--> decision` даёт ровно одну карточку. До него звено
   * закрывалось пропуском не потому, что было запрещено, а потому что
   * рассматривать было нечего — и это выяснил прогон, а не рассуждение.
   */
  test("12. влияние изменения: воркер считает, архитектор рассматривает", async ({ browser }) => {
    const architect = await requestAs(browser, "designer");

    // 1. До расчёта рассматривать нечего, и поверхность признаёт это причиной
    //    предпосылки, а не авторизации.
    const beforeWorker = await workspace(architect);
    expect(beforeWorker.operations.review_change_impact?.status).toBe("unavailable");
    expect(beforeWorker.operations.review_change_impact?.reason).toBe("prerequisite_missing");
    expect(beforeWorker.changes.find((entry) => entry.impactRunId !== null)).toBeFalsy();

    // 2. Очередь воркер находит сам: идентификатора заявки ему не передаётся.
    const report = runChangeImpactWorker();
    expect(report.scanned).toBeGreaterThan(0);
    expect(report.calculated).toBeGreaterThan(0);
    expect(report.calculatedTruncated).toBe(0);
    expect(report.needsAttention).toBe(0);
    expect(report.policy.maxDepth).toBeGreaterThan(0);

    // 3. КАРТОЧКА СУЩЕСТВУЕТ ДО РАССМОТРЕНИЯ. Прогон непустой, привязан к
    //    заявке, не усечён и не закрыт.
    const afterWorker = await workspace(architect);
    const change = afterWorker.changes.find((entry) => entry.impactRunId !== null);
    expect(change, "воркер не привязал прогон влияния ни к одной заявке").toBeTruthy();
    // Ровно одна: шаг 5б создаёт ровно одно обратное ребро. Проверка на
    // точное число, а не «больше нуля», — иначе лишняя связь, появившаяся
    // однажды, прошла бы незамеченной вместе с изменившимся смыслом звена.
    expect(change!.impactCount).toBe(1);
    expect(change!.impactTruncated).toBe(false);
    expect(change!.impactReviewComplete).toBe(false);
    expect(change!.reviewedImpactCount).toBe(0);

    const pending = change!.impacts.find((impact) => impact.disposition === null);
    expect(pending, "у непустого прогона нет ни одной нерассмотренной карточки").toBeTruthy();

    // 4. АРХИТЕКТОР ИМЕЕТ ПРАВО ЕЁ РАССМОТРЕТЬ — поверхность предлагает
    //    действие и указывает ровно ту карточку.
    expect(afterWorker.operations.review_change_impact?.status).toBe("available");
    expect(afterWorker.operations.review_change_impact?.commandTargetId)
      .toBe(pending!.impactId);

    // 5. РАССМОТРЕНИЕ МЕНЯЕТ СОСТОЯНИЕ. Публичный маршрут команд, сессия
    //    архитектора, никакого service role.
    const reviewed = await command(architect, "review_change_impact", {
      impactRunId: pending!.impactRunId,
      impactId: pending!.impactId,
      disposition: "resolved",
      reason: "AP5: влияние разобрано архитектором в своей сессии",
    });
    expect(reviewed.status, JSON.stringify(reviewed.body.error)).toBe(200);
    expect(reviewed.body.status).toBe("completed");
    // Результат возвращается КЛИЕНТУ, а не только оседает в базе.
    expect(reviewed.body.result?.disposition).toBe("resolved");
    expect(reviewed.body.result?.impactId).toBe(pending!.impactId);
    expect(reviewed.body.result?.allImpactsReviewed).toBe(true);
    expect(reviewed.body.result?.everyImpactReviewed).toBe(true);
    expect(reviewed.body.result?.isTruncated).toBe(false);

    // 6. КЛИЕНТ ПОЛУЧАЕТ ФАКТИЧЕСКИЙ РЕЗУЛЬТАТ: то же самое видно в чтении
    //    рабочего пространства, а не только в ответе команды.
    const afterReview = await workspace(architect);
    const reviewedChange = afterReview.changes.find((entry) => entry.id === change!.id);
    expect(reviewedChange!.reviewedImpactCount).toBe(reviewedChange!.impactCount);
    expect(reviewedChange!.impactReviewComplete).toBe(true);
    expect(
      reviewedChange!.impacts.find((impact) => impact.impactId === pending!.impactId)?.disposition,
    ).toBe("resolved");
    // Нерассмотренных карточек не осталось — поверхность снова закрыта по
    // предпосылке, а не по авторизации.
    expect(afterReview.operations.review_change_impact?.status).toBe("unavailable");
    expect(afterReview.operations.review_change_impact?.reason).toBe("prerequisite_missing");

    // 7. ПОВТОРНАЯ ОПЕРАЦИЯ ОТКЛОНЯЕТСЯ. Второе решение по той же карточке — не
    //    повтор команды (ключ идемпотентности другой), а попытка пересмотреть
    //    уже принятое.
    const twice = await command(architect, "review_change_impact", {
      impactRunId: pending!.impactRunId,
      impactId: pending!.impactId,
      disposition: "accepted",
      reason: "AP5: повторное решение по уже рассмотренной карточке",
    });
    expect(twice.status).toBe(400);
    expect(twice.body.error?.code).toBe("unsupported_source");

    // 8. НЕДОПУСТИМАЯ ОПЕРАЦИЯ ОТКЛОНЯЕТСЯ: подтверждать неполноту полного
    //    прогона нечего, и сервер это говорит сам.
    const acknowledged = await command(architect, "acknowledge_impact_truncation", {
      impactRunId: change!.impactRunId!,
      reason: "AP5: подтверждение неполноты полного прогона",
    });
    expect(acknowledged.status).toBe(400);
    expect(acknowledged.body.error?.code).toBe("unsupported_source");

    // 9. Второй проход воркера не заводит второго прогона и не трогает
    //    рассмотренное.
    const second = runChangeImpactWorker();
    expect(second.calculated).toBe(0);
    const afterSecond = await workspace(architect);
    expect(afterSecond.changes.find((entry) => entry.id === change!.id)!.impactReviewComplete)
      .toBe(true);
  });
});

/**
 * Оставшиеся звенья цепочки AP5 из MASTER_EXECUTION_PLAN §AP5. Каждое помечено
 * причиной, а не молча пропущено: красный или пропущенный шаг здесь означает
 * «не доказано», и в отчёте гейта он виден именно так.
 */
test.describe("AP5 — ещё не покрытые звенья", () => {
  // Три звена ушли отсюда 11.08, и каждое — потому что доказано, а не потому
  // что причина перестала нравиться. Строка-пропуск на пройденном звене — это
  // отчёт, который врёт:
  //   * «Decision/Selection approval → ProjectBaseline V1» — шаг 6 (гейт 1);
  //   * «ProductionPackageVersion V1 → распространение и подтверждение» —
  //     шаги 7, 9 и 10 (гейт 1 и гейт 2);
  //   * заявка на изменение — шаг 11;
  //   * влияние изменения целиком — шаг 12 (V1 Impact, 12.08.2026): системный
  //     расчёт И рассмотрение архитектором. Пропуск стоял по трём причинам
  //     подряд: воркера не существовало, команда не была авторизована, а
  //     прогон получался пустым. Сняты все три — последнюю снял шаг 5б, узел
  //     графа, зависящий от изменённого решения.
  test.fixme(
    "фотодоказательство и приёмка вехи",
    // upload_photo_evidence требует существующего milestoneId; вех в проекте
    // без воркерного плана нет.
    () => {},
  );
});
