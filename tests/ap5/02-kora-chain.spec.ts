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
  AP5_DECISION_REVISION_ID_3,
  AP5_DECISION_REVISION_ID_4,
  AP5_DEPENDENT_SOURCE_ID,
  AP5_SOURCE_NAME,
  AP5_SOURCE_REVISION_ID,
  type Ap5RoleKey,
} from "./ap5-env";
import { runReleaseArtifactWorker } from "./release-worker";
import { runChangeImpactWorker } from "./change-impact-worker";
import { ingestDependentNode } from "./dependent-node";
import { ingestDepthChain, ingestWideStar } from "./coverage-graph";
import { accessTokenFor, clientForToken } from "./rpc-session";

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

function commandDiagnostic(result: CommandResult): string {
  return `status=${result.status} code=${result.body.error?.code ?? "unknown"}`;
}

function rpcDiagnostic(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { readonly code?: unknown }).code;
    if (typeof code === "string") return `code=${code}`;
  }
  return "code=unknown";
}

function workerDiagnostic(report: {
  readonly created: number;
  readonly scanned: number;
  readonly alreadyPresent?: number;
}): string {
  return `created=${report.created} scanned=${report.scanned}`
    + ` alreadyPresent=${report.alreadyPresent ?? "unknown"}`;
}

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
      + `issues=${contract.error.issues.length}`,
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
    // "current" = наибольший versionNo пакета — используется звеньями 14/15,
    // чтобы явно выбрать производственную версию для `create_change`, а не
    // положиться на подсказку `operations.create_change.commandTargetId`
    // (она берёт САМУЮ СТАРУЮ версию, не сопоставленную latestBaseline, — для
    // цепочки из нескольких baseline подряд это не то, что нужно).
    readonly status: string;
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
    // DEC-034 coverage — звенья 13/14 (V1 Impact coverage states).
    readonly coverageStatus: "complete" | "partial_depth" | "blocked_result_limit" | null;
    readonly knownImpactCountLowerBound: number | null;
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
    expect(result.status, commandDiagnostic(result)).toBe(200);
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
    expect(result.status, commandDiagnostic(result)).toBe(404);
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
    expect(decision.status, commandDiagnostic(decision)).toBe(200);

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
   * 5а. Area-node пришёл через настоящий authenticated ingest, после чего
   * выбор создаётся браузерной командой. Самой команды для регистрации
   * площади нет: ingest остаётся единственной серверной дверью для графовой
   * геометрии и выполняется не service role, а сессией архитектора.
   */
  test("5а. выбор привязан к площади из authenticated ingest", async ({ browser }) => {
    const architect = await requestAs(browser, "designer");
    const selection = await command(architect, "create_selection", {
      packageId: handoff().rootPackageId,
      nodeId: "ap5-selection-floor-1",
      revisionId: randomUUID(),
      expectedRevisionId: null,
      claimStatus: "human_origin",
      title: "AP5 selection",
      areaNodeId: "ap5-area-floor-1",
      decisionRevisionId: AP5_DECISION_REVISION_ID,
      specification: { finish: "AP5 reference finish" },
      evidence: [],
      reason: "AP5 authenticated browser chain",
    });
    expect(selection.status, commandDiagnostic(selection)).toBe(200);
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
    expect(created.status, commandDiagnostic(created)).toBe(200);

    const submitted = await command(architect, "submit_approval_package", {
      approvalPackageId,
      expectedStatus: "draft",
    });
    expect(submitted.status, commandDiagnostic(submitted)).toBe(200);

    const approved = await command(architect, "review_selection", {
      approvalPackageId,
      expectedStatus: "submitted",
      decision: "approved",
      reason: "AP5 authenticated browser chain",
    });
    expect(approved.status, commandDiagnostic(approved)).toBe(200);

    // Поверхность обязана предложить публикацию и выдать токен: именно его
    // команда потребует назад, и именно он ловит гонку.
    const view = await workspace(architect);
    expect(view.operations.publish_baseline?.status).toBe("available");
    const snapshotToken = view.operations.publish_baseline?.commandTargetId;
    expect(snapshotToken).toBeTruthy();

    const published = await command(architect, "publish_baseline", { snapshotToken });
    expect(published.status, commandDiagnostic(published)).toBe(200);

    // Устаревший токен обязан быть отвергнут, а не опубликован повторно:
    // после публикации состояние сдвинулось.
    const stale = await command(architect, "publish_baseline", { snapshotToken });
    expect(stale.status, commandDiagnostic(stale)).toBe(409);
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
    expect(published.status, commandDiagnostic(published)).toBe(200);

    // Повтор тем же токеном обязан быть отвергнут: версия сдвинула состояние,
    // и второй выпуск выражал бы уже не то, что показывали.
    const stale = await command(architect, "publish_release", { snapshotToken });
    expect(stale.status, commandDiagnostic(stale)).toBe(409);
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
    // чём, их не открывал ни один документ. `acknowledge_impact_truncation`
    // (DEC-034, поверх DEC-033 LOCKED) сюда же: PR #94 её авторизовал тем же GO,
    // что `review_change_impact`, но человеческого override усечённого прогона
    // в V1 не существует — дверь закрыта навсегда, той же причиной, что V2/V3.
    for (const kind of [
      "upload_photo_evidence",
      "review_photo_evidence",
      "accept_milestone",
      "build_handover",
      "acknowledge_impact_truncation",
    ]) {
      expect(operations[kind]?.status, kind).toBe("unavailable");
      expect(operations[kind]?.reason, kind).toBe("increment_not_authorized");
    }

    // А вот `review_change_impact` с 12.08.2026 АВТОРИЗОВАНА, и её недоступность
    // здесь — другого рода: прогона влияния ещё нет (звено 12 его создаст).
    // Разница в причине и есть предмет проверки: назвать открытую команду
    // «неавторизованной» значило бы соврать о состоянии продукта ровно так же,
    // как назвать закрытую «недостающей предпосылкой».
    expect(operations.review_change_impact?.status).toBe("unavailable");
    expect(operations.review_change_impact?.reason).toBe("prerequisite_missing");

    // Поверхность — половина запрета. Вторая половина в том, что команда,
    // посланная в обход интерфейса, отклоняется сервером до единого чтения и
    // записи, а не доходит до RPC и не получает отказ по правам.
    const denied = await command(owner, "accept_milestone", {
      milestoneId: "a5d0c1c1-0000-4000-8000-00000000dead",
    });
    expect(denied.status, commandDiagnostic(denied)).toBe(409);
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
    expect(worker.created, workerDiagnostic(worker)).toBeGreaterThan(0);

    // Повтор — no-op: очередь пуста, второго артефакта не появляется. Это то
    // же свойство, что DB4 проверяет на гонке, но здесь оно проверено на живом
    // стеке настоящим процессом.
    const repeat = runReleaseArtifactWorker();
    expect(repeat.created, workerDiagnostic(repeat)).toBe(0);
    expect(repeat.scanned, workerDiagnostic(repeat)).toBe(0);

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
    expect(distributed.status, commandDiagnostic(distributed)).toBe(200);

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
    expect(acknowledged.status, commandDiagnostic(acknowledged)).toBe(200);

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
    expect(revised.status, commandDiagnostic(revised)).toBe(200);

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
    expect(created.status, commandDiagnostic(created)).toBe(200);

    const submitted = await command(architect, "submit_approval_package", {
      approvalPackageId,
      expectedStatus: "draft",
    });
    expect(submitted.status, commandDiagnostic(submitted)).toBe(200);

    const approved = await command(architect, "review_selection", {
      approvalPackageId,
      expectedStatus: "submitted",
      decision: "approved",
      reason: "AP5 authenticated browser chain",
    });
    expect(approved.status, commandDiagnostic(approved)).toBe(200);

    const beforeSecondBaseline = await workspace(architect);
    expect(beforeSecondBaseline.operations.publish_baseline?.status).toBe("available");
    const snapshotToken = beforeSecondBaseline.operations.publish_baseline?.commandTargetId;
    expect(snapshotToken).toBeTruthy();

    const secondBaseline = await command(architect, "publish_baseline", { snapshotToken });
    expect(secondBaseline.status, commandDiagnostic(secondBaseline)).toBe(200);

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
    expect(change.status, commandDiagnostic(change)).toBe(200);

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
    expect(reviewed.status, commandDiagnostic(reviewed)).toBe(200);
    expect(reviewed.body.status).toBe("completed");
    // Результат возвращается КЛИЕНТУ, а не только оседает в базе.
    expect(reviewed.body.result?.disposition).toBe("resolved");
    expect(reviewed.body.result?.impactId).toBe(pending!.impactId);
    // DEC-034: все ВОЗВРАЩЁННЫЕ карточки рассмотрены И обход исчерпан
    // (золотой граф Kora даёт `complete`, не `partial_depth`) — только тогда
    // `impactReviewComplete` действительно значит «закончено». Человеческого
    // подтверждения неполноты (`acknowledge_impact_truncation`) в этой цепочке
    // не требуется и не существует — см. п. 8 ниже.
    expect(reviewed.body.result?.allReturnedImpactsReviewed).toBe(true);
    expect(reviewed.body.result?.coverageComplete).toBe(true);
    expect(reviewed.body.result?.impactReviewComplete).toBe(true);
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
    // База отвечает `P1110 invalid_transition {"reason":"IMPACT_ALREADY_REVIEWED"}`,
    // а командная поверхность НАМЕРЕННО сужает словарь: `errorCode()` в
    // `command-service.ts` сворачивает `unsupported_source` в
    // `validation_failed`. Здесь проверяется то, что видит клиент, поэтому
    // ожидание — суженный код, а не внутренний.
    expect(twice.body.error?.code).toBe("validation_failed");
    // Отказ обязан быть НАСТОЯЩИМ: решение по карточке осталось прежним, и
    // счётчик не сдвинулся. Один код ответа этого не доказывает.
    const afterTwice = await workspace(architect);
    const unchanged = afterTwice.changes.find((entry) => entry.id === change!.id)!;
    expect(unchanged.reviewedImpactCount).toBe(reviewedChange!.reviewedImpactCount);
    expect(
      unchanged.impacts.find((impact) => impact.impactId === pending!.impactId)?.disposition,
    ).toBe("resolved");

    // 8. ДВЕРЬ ПОДТВЕРЖДЕНИЯ НЕПОЛНОТЫ НЕДОСТУПНА НАВСЕГДА (DEC-034, поверх
    //    DEC-033 LOCKED). Человеческого override в V1 не существует: попытка
    //    вызвать её отклоняется командным сервисом ДО обращения к базе — тем
    //    же кодом, что закрытые V2/V3, не «неверный ввод» и не «нет
    //    предпосылки». Заявленная предпосылка (валидный `impactRunId` живой,
    //    рассмотренной сессией архитектора) сама по себе НЕ делает дверь
    //    доступной — она закрыта авторизацией, не отсутствием повода.
    const acknowledged = await command(architect, "acknowledge_impact_truncation", {
      impactRunId: change!.impactRunId!,
      reason: "AP5: попытка вызвать закрытую дверь подтверждения неполноты",
    });
    expect(acknowledged.status, commandDiagnostic(acknowledged)).toBe(409);
    expect(acknowledged.body.error?.code).toBe("operation_unavailable");

    // 9. Второй проход воркера не заводит второго прогона и не трогает
    //    рассмотренное.
    const second = runChangeImpactWorker();
    expect(second.calculated).toBe(0);
    const afterSecond = await workspace(architect);
    expect(afterSecond.changes.find((entry) => entry.id === change!.id)!.impactReviewComplete)
      .toBe(true);
  });

  /**
   * 13. RPC воркера расчёта влияния — недостижимы человеческой сессией
   *     (блокер 3 из OWNER REVIEW 12.08.2026: «Authorization»).
   *
   * Тест 12 доказывает поверхность ЧЕЛОВЕКА (`review_change_impact`, публичный
   * маршрут команд). Здесь доказывается обратное: три системные двери —
   * `calculate_change_impact`, `calculate_change_impact_policy_bound`,
   * `list_change_impact_backlog` — выданы ТОЛЬКО `service_role`
   * (`20260812010000`, `20260813030000) и отозваны у `authenticated`. Вызов
   * идёт НАСТОЯЩИМ токеном отдельной аутентифицированной сессии архитектора
   * через реальный Data API (PostgREST), в обход приложения — тот же приём,
   * что `tests/ap1/environment/verify-m4-data-api-closed.mjs`.
   *
   * Аргументы намеренно негодные (несуществующие project/changeRequest):
   * отказ обязан прийти по правам, ДО тела функции. 400 недопустим так же,
   * как успех — он значил бы, что роль эту RPC вообще видит.
   */
  test("13. RPC воркера расчёта влияния недостижимы человеческой сессией", async () => {
    const token = await accessTokenFor("designer");
    const client = clientForToken(token);

    // Контроль: токен настоящий и рабочий — иначе отказ ниже доказывал бы
    // сломанный токен, а не границу авторизации.
    const control = await client.schema("projectceo_api").rpc("list_projects");
    expect(control.error, rpcDiagnostic(control.error)).toBeNull();

    const probeProject = "00000000-0000-4000-8000-000000000000";
    const probeChangeRequest = "00000000-0000-4000-8000-000000000001";
    const allowedDeniedStatus = [401, 403, 404];

    const calculateChangeImpact = await client
      .schema("projectceo_m4_api")
      .rpc("calculate_change_impact", {
        project_id: probeProject,
        change_request_id: probeChangeRequest,
        max_depth: 1,
        expected_state_revision: 1,
        idempotency_key: "ap5-authz-probe-calculate",
      });
    expect(calculateChangeImpact.data).toBeNull();
    expect(
      allowedDeniedStatus,
      `calculate_change_impact: ${calculateChangeImpact.status} ${rpcDiagnostic(calculateChangeImpact.error)}`,
    ).toContain(calculateChangeImpact.status);

    const calculateChangeImpactPolicyBound = await client
      .schema("projectceo_m4_api")
      .rpc("calculate_change_impact_policy_bound", {
        project_id: probeProject,
        change_request_id: probeChangeRequest,
        expected_state_revision: 1,
        idempotency_key: "ap5-authz-probe-policy-bound",
      });
    expect(calculateChangeImpactPolicyBound.data).toBeNull();
    expect(
      allowedDeniedStatus,
      `calculate_change_impact_policy_bound: ${calculateChangeImpactPolicyBound.status} `
      + rpcDiagnostic(calculateChangeImpactPolicyBound.error),
    ).toContain(calculateChangeImpactPolicyBound.status);

    const listChangeImpactBacklog = await client
      .schema("projectceo_m4_api")
      .rpc("list_change_impact_backlog", { max_rows: 10 });
    expect(listChangeImpactBacklog.data).toBeNull();
    expect(
      allowedDeniedStatus,
      `list_change_impact_backlog: ${listChangeImpactBacklog.status} `
      + rpcDiagnostic(listChangeImpactBacklog.error),
    ).toContain(listChangeImpactBacklog.status);
  });

  /**
   * Общая механика звеньев 14/15: новый корень изменения — это ВСЕГДА
   * пересмотр того же решения (`AP5_DECISION_NODE_ID`), одобренный и
   * опубликованный как новый baseline, плюс производственная версия,
   * зафиксированная на ПРЕДЫДУЩЕМ baseline (иначе `submit_change_request`
   * отклонит переход как `CHANGE_BASELINE_LINEAGE_INVALID` — переход
   * принимается только от baseline, на котором реально стоит производственная
   * версия, к его непосредственному наследнику).
   */
  async function buildProductionVersionAtLatestBaseline(
    architect: APIRequestContext,
  ): Promise<void> {
    const before = await workspace(architect);
    expect(before.operations.publish_release?.status).toBe("available");
    const snapshotToken = before.operations.publish_release?.commandTargetId;
    const released = await command(architect, "publish_release", { snapshotToken });
    expect(released.status, commandDiagnostic(released)).toBe(200);
  }

  async function reviseApproveAndPublishBaseline(
    architect: APIRequestContext,
    revisionId: string,
    expectedRevisionId: string,
    label: string,
  ): Promise<void> {
    const revised = await command(architect, "create_decision", {
      packageId: handoff().rootPackageId,
      nodeId: AP5_DECISION_NODE_ID,
      revisionId,
      expectedRevisionId,
      claimStatus: "human_origin",
      title: `AP5 decision (${label})`,
      resolution: `AP5 chain decision revised for the ${label} coverage scenario.`,
      areaNodeId: null,
      decisionStatus: "confirmed",
      evidence: [],
      reason: `AP5 authenticated browser chain — ${label} coverage scenario`,
    });
    expect(revised.status, commandDiagnostic(revised)).toBe(200);

    const approvalPackageId = `ap5-approval-${label}-${randomUUID()}`;
    const created = await command(architect, "create_approval_package", {
      packageId: handoff().rootPackageId,
      approvalPackageId,
      items: [{ targetKind: "decision_revision", entityId: AP5_DECISION_NODE_ID, revisionId }],
    });
    expect(created.status, commandDiagnostic(created)).toBe(200);

    const submitted = await command(architect, "submit_approval_package", {
      approvalPackageId,
      expectedStatus: "draft",
    });
    expect(submitted.status, commandDiagnostic(submitted)).toBe(200);

    const approved = await command(architect, "review_selection", {
      approvalPackageId,
      expectedStatus: "submitted",
      decision: "approved",
      reason: "AP5 authenticated browser chain",
    });
    expect(approved.status, commandDiagnostic(approved)).toBe(200);

    const beforeBaseline = await workspace(architect);
    expect(beforeBaseline.operations.publish_baseline?.status).toBe("available");
    const snapshotToken = beforeBaseline.operations.publish_baseline?.commandTargetId;
    const published = await command(architect, "publish_baseline", { snapshotToken });
    expect(published.status, commandDiagnostic(published)).toBe(200);
  }

  async function createChangeFromCurrentProductionVersion(
    architect: APIRequestContext,
    builder: APIRequestContext,
    reason: string,
  ): Promise<string> {
    // НЕ `operations.create_change.commandTargetId`: та подсказка находит
    // САМУЮ СТАРУЮ производственную версию, чей baseline отличается от
    // текущего последнего (`packageVersions` отсортирован по возрастанию
    // `versionNo`, а подсказка — первое совпадение), а не версию, реально
    // спаренную с последним baseline. Для одного перехода (звено 11) это одно
    // и то же; для цепочки из нескольких baseline подряд — уже нет: заявка
    // ушла бы со старым `fromBaselineId`, для которого `proposedBaselineId`
    // (всегда последний baseline) не является непосредственным наследником,
    // и `submit_change_request` отклонил бы её как
    // `CHANGE_BASELINE_LINEAGE_INVALID`. Версия «current» — та, что реально
    // построена НА предыдущем шаге ИМЕННО для этого перехода.
    const architectView = await workspace(architect);
    const currentRelease = architectView.releases.find((release) => release.status === "current");
    expect(currentRelease, "AP5: нет текущей производственной версии для заявки").toBeTruthy();

    const before = await workspace(builder);
    expect(before.operations.create_change?.status).toBe("available");
    const created = await command(builder, "create_change", {
      reason,
      fromProductionPackageVersionId: currentRelease!.id,
      deltaCostRub: 0,
      deltaDays: 0,
    });
    expect(created.status, commandDiagnostic(created)).toBe(200);
    const change = (await workspace(builder)).changes.find((entry) => entry.reason === reason);
    expect(change, `AP5: заявка «${reason}» не найдена в рабочем пространстве`).toBeTruthy();
    return change!.id;
  }

  const PARTIAL_DEPTH_REASON =
    "AP5: обход упирается в глубину политики — частичный охват (partial_depth)";

  /**
   * 14. `partial_depth` на настоящей странице (блокер 3, «partial_depth»).
   *
   * Глубокая цепочка (звено 5б плюс `ingestDepthChain`, глубже текущей
   * политики) даёт обход, который система не может пройти целиком. Расчёт
   * делает настоящий системный воркер, а КАЖДОЕ утверждение о том, что видит
   * человек, — через настоящую страницу `page`, локаторы и видимый текст, не
   * через JSON команды: рассмотреть можно ВСЕ показанные карточки и всё равно
   * остаться «не закрыто» — это и есть DEC-033/034, и его нельзя доказать
   * ответом API, только тем, что реально нарисовано.
   */
  test("14. частичный охват (partial_depth) на настоящей странице", async ({ browser }) => {
    const architect = await requestAs(browser, "designer");

    await ingestDepthChain();
    await buildProductionVersionAtLatestBaseline(architect);
    await reviseApproveAndPublishBaseline(
      architect,
      AP5_DECISION_REVISION_ID_3,
      AP5_DECISION_REVISION_ID_2,
      "partial-depth",
    );

    const builder = await requestAs(browser, "builder");
    const changeId = await createChangeFromCurrentProductionVersion(
      architect,
      builder,
      PARTIAL_DEPTH_REASON,
    );

    const report = runChangeImpactWorker();
    const item = report.items.find((entry) => entry.changeRequestId === changeId);
    expect(item, "AP5: воркер не увидел новую заявку глубокой цепочки").toBeTruthy();
    expect(item!.outcome).toBe("calculated_truncated");
    expect(item!.truncationReason).toBe("depth_limit");

    // Настоящая страница, настоящая сессия архитектора — не context.request.
    const context = await browser.newContext({
      baseURL: env.appUrl,
      storageState: storageStatePath("designer"),
    });
    const page = await context.newPage();
    const response = await page.goto(`/dashboard/projectceo/projects/${handoff().projectId}`);
    expect(response?.status()).toBe(200);
    await page.getByRole("tab", { name: "Изменения" }).click();

    const card = page.locator("article").filter({ hasText: PARTIAL_DEPTH_REASON });
    await expect(card).toBeVisible();
    // Текст — дословно из lib/i18n/ru.ts (`coveragePartialWarning`), не
    // перефразирован: любое расхождение здесь означало бы, что скопирован
    // не тот текст, который реально покажет пользователю продукт.
    await expect(card.getByText(
      "Показаны найденные влияния. Анализ ограничен глубиной и не является полным.",
    )).toBeVisible();

    const reviewButtonName = "Отметить решённым";
    let remaining = await card.getByRole("button", { name: reviewButtonName }).count();
    expect(remaining, "AP5: у частичного прогона нет ни одной карточки на рассмотрение").toBeGreaterThan(0);
    const shown = remaining;

    // Рассматриваются ВСЕ показанные карточки — настоящим кликом по
    // настоящей кнопке, не вызовом команды в обход вёрстки.
    while (remaining > 0) {
      const button = card.getByRole("button", { name: reviewButtonName }).first();
      await Promise.all([
        page.waitForResponse((candidate) => candidate.url().includes("/api/projectceo/commands")),
        button.click(),
      ]);
      remaining -= 1;
      await expect(card.getByRole("button", { name: reviewButtonName })).toHaveCount(remaining);
    }

    // ВСЕ показанные карточки рассмотрены — и обход всё равно неполный: DOM
    // обязан показать оба факта одновременно, иначе «8 из 8» читалось бы как
    // законченный обзор (ровно та ложь, которую запрещает DEC-033/034).
    await expect(card.getByText(`Рассмотрено найденных влияний ${shown}/${shown}`)).toBeVisible();
    await expect(card.getByText("Рассмотрение не закрыто")).toBeVisible();

    // Человеческого override неполноты не существует нигде на странице — ни
    // здесь, ни в другом месте: ни одной кнопки с таким смыслом.
    await expect(page.getByRole("button", { name: /подтверд/i })).toHaveCount(0);

    await context.close();
  });

  const BLOCKED_RESULT_LIMIT_REASON =
    "AP5: найдено многократно больше лимита результата — блокировка (blocked_result_limit)";

  /**
   * 15. `blocked_result_limit` на настоящей странице (блокер 3,
   *     «blocked_result_limit»).
   *
   * Широкая звезда (`ingestWideStar`, `AP5_WIDE_STAR_LEAF_COUNT` листьев —
   * заведомо больше текущего `maxImpacts`) даёт обход, который упирается в
   * лимит результата раньше, чем в глубину: DEC-034 отдаёт приоритет лимиту —
   * ничего не сохраняется, `returnedImpactCount = 0`. Доказывается ровно это
   * на настоящей странице: видимый текст блокировки, ПОЛНОЕ отсутствие кнопок
   * рассмотрения (рассматривать нечего — не «пока недоступно», а «нечего»), и
   * то, что заявка исчезла из воркерной очереди совсем, а не «пока не
   * подошла очередь».
   */
  test("15. заблокированный результат (blocked_result_limit) на настоящей странице", async ({ browser }) => {
    const architect = await requestAs(browser, "designer");

    // Производственная версия сначала — на baseline, который сейчас
    // последний (опубликован звеном 14); звезда входит в граф ДО следующей
    // публикации baseline, как и везде в этой цепочке.
    await buildProductionVersionAtLatestBaseline(architect);
    await ingestWideStar();
    await reviseApproveAndPublishBaseline(
      architect,
      AP5_DECISION_REVISION_ID_4,
      AP5_DECISION_REVISION_ID_3,
      "blocked-result-limit",
    );

    const builder = await requestAs(browser, "builder");
    const changeId = await createChangeFromCurrentProductionVersion(
      architect,
      builder,
      BLOCKED_RESULT_LIMIT_REASON,
    );

    const report = runChangeImpactWorker();
    const item = report.items.find((entry) => entry.changeRequestId === changeId);
    expect(item, "AP5: воркер не увидел новую заявку широкой звезды").toBeTruthy();
    expect(item!.outcome).toBe("calculated_blocked");
    expect(item!.truncationReason).toBe("result_limit");

    const context = await browser.newContext({
      baseURL: env.appUrl,
      storageState: storageStatePath("designer"),
    });
    const page = await context.newPage();
    const response = await page.goto(`/dashboard/projectceo/projects/${handoff().projectId}`);
    expect(response?.status()).toBe(200);
    await page.getByRole("tab", { name: "Изменения" }).click();

    const card = page.locator("article").filter({ hasText: BLOCKED_RESULT_LIMIT_REASON });
    await expect(card).toBeVisible();
    // `knownImpactCountLowerBound` — ВСЕГДА ровно `maxImpacts + 1` при
    // блокировке (`20260813010000`), не истинный размер звезды: число в
    // тексте отражает текущую политику, а не размер фикстуры.
    await expect(card.getByText(/^Обнаружено не менее \d+ влияния\. Сузьте изменение\.$/))
      .toBeVisible();

    // Рассматривать нечего ВООБЩЕ: блок с действиями завязан на
    // `impactCount > 0`, а у блокировки он ноль — весь раздел с кнопками не
    // рендерится, а не просто дизейблится.
    await expect(card.getByRole("button", { name: "Принять влияние" })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Отметить решённым" })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Не влияет" })).toHaveCount(0);

    // Заявка исчезла из воркерной очереди СОВСЕМ — второй проход её не
    // находит (расчёт уже состоялся, исход не имеет значения — DEC-034 п. 4).
    const second = runChangeImpactWorker();
    expect(second.items.some((entry) => entry.changeRequestId === changeId)).toBe(false);

    await context.close();
  });
});

/**
 * M4 increment 2 пока не авторизован решением владельца. AP5 всё равно
 * проверяет эту границу на настоящей странице и настоящим command route:
 * операция не предлагается, а поддельная цель не доходит до RPC.
 */
test.describe("AP5 — M4 increment 2 boundary", () => {
  test("фотодоказательство и приёмка вехи остаются закрытыми", async ({ browser }) => {
    const owner = await requestAs(browser, "owner");
    const operations = (await workspace(owner)).operations;
    for (const kind of ["upload_photo_evidence", "review_photo_evidence", "accept_milestone"]) {
      expect(operations[kind]?.status, kind).toBe("unavailable");
      expect(operations[kind]?.reason, kind).toBe("increment_not_authorized");
    }

    const denied = await command(owner, "upload_photo_evidence", {
      milestoneId: "a5d0c1c1-0000-4000-8000-000000000099",
      areaNodeId: "ap5-area-floor-1",
      sourceId: "ap5-photo-source",
      sourceRevisionId: "ap5-photo-revision-1",
      capturedAt: new Date().toISOString(),
      note: null,
    });
    expect(denied.status, commandDiagnostic(denied)).toBe(409);
    expect(denied.body.error?.code).toBe("operation_unavailable");
  });
});
