import { createHash } from "node:crypto";

import {
  readHandoff,
  AP5_DECISION_NODE_ID,
  AP5_DEPENDENT_EDGE_ID,
  AP5_DEPENDENT_NODE_ID,
  AP5_DEPENDENT_REVISION_ID,
  AP5_DEPENDENT_SOURCE_ID,
} from "./ap5-env";
import { accessTokenFor, clientForToken } from "./rpc-session";

/**
 * Узел графа, ЗАВИСЯЩИЙ от решения цепочки.
 *
 * ЗАЧЕМ. Влияние изменения идёт по обратным рёбрам: обход стартует от
 * изменённого узла и ищет рёбра, чей `toNodeId` — этот узел
 * (`calculate_change_impact`, набор отношений `depends_on`, `derived_from`,
 * `specified_by`, `satisfies`). В цепочке AP5 такого ребра не было ни одного,
 * поэтому прогон влияния получался пустым и рассматривать было нечего.
 *
 * ПОЧЕМУ ИМЕННО RPC, А НЕ БРАУЗЕР. Рёбра графа пишет ровно одна функция —
 * `projectceo_api.ingest_source_graph`, и HTTP-поверхности у неё нет: ни
 * маршрута, ни элемента интерфейса. Это тот же класс отступления, что уже
 * зафиксирован в `AP5_RUNBOOK.md` для `enroll_organization_project`, и он
 * ограничен ровно им: вызов идёт ТОКЕНОМ ЧЕЛОВЕКА (архитектор — designer), а
 * не service role. Права это подтверждают: `ingest_source_graph` выдана
 * `authenticated` и ОТОЗВАНА у `service_role` (`20260717092000`), то есть
 * системная identity её выполнить не может даже при желании.
 *
 * ЧТО ЗДЕСЬ НЕ ПОДМЕНЯЕТСЯ. Ни расчёт влияния, ни рассмотрение: обход считает
 * настоящая RPC по настоящим рёбрам, а карточку рассматривает архитектор своей
 * браузерной сессией через публичный маршрут команд. Здесь создаётся только
 * предметная область — узел и ребро, которые в живом проекте создал бы ingest
 * реального источника.
 *
 * ПОРЯДОК. Шаг обязан идти ДО публикации baseline: `publish_baseline` снимает
 * версию графа целиком (`publish_version` копирует все `graph_edges` в
 * `version_edges`), и ребро, добавленное после снимка, в целевую версию не
 * попадёт — обход его не увидит.
 */
export interface DependentNodeResult {
  readonly ingestionId: string;
  readonly sourceId: string;
}

export async function ingestDependentNode(): Promise<DependentNodeResult> {
  const token = await accessTokenFor("designer");
  const client = clientForToken(token);

  const handoff = readHandoff();
  const projects = await client.schema("projectceo_api").rpc("list_projects");
  if (projects.error) {
    throw new Error(`AP5: список проектов недоступен: ${projects.error.message}`);
  }
  const scope = (projects.data as { readonly data: readonly {
    readonly projectId: string;
    readonly stateRevision: number;
  }[] }).data.find((entry) => entry.projectId === handoff.projectId);
  if (!scope) throw new Error("AP5: архитектор не видит проект цепочки");

  const payload = {
    kind: "specification",
    title: "AP5 dependent specification",
    dependsOn: AP5_DECISION_NODE_ID,
  };
  const checksumHex = createHash("sha256").update(AP5_DEPENDENT_SOURCE_ID).digest("hex");

  const ingest = await client.schema("projectceo_api").rpc("ingest_source_graph", {
    project_id: handoff.projectId,
    source: {
      sourceId: AP5_DEPENDENT_SOURCE_ID,
      sourceRevisionId: AP5_DEPENDENT_REVISION_ID,
      kind: "document",
      checksumHex,
      packageId: handoff.rootPackageId,
      metadata: {
        originalFilename: "ap5-dependent-spec.pdf",
        mediaType: "application/pdf",
        sizeBytes: 2048,
        extension: "pdf",
        sourceRole: "specification",
        declaredRevision: null,
        documentStatus: "current",
      },
    },
    fragments: [],
    // Узел спецификации: он и станет затронутым в прогоне влияния.
    nodes: [{
      nodeId: AP5_DEPENDENT_NODE_ID,
      kind: "source",
      stableKey: `source:${AP5_DEPENDENT_SOURCE_ID}`,
      currentRevisionId: AP5_DEPENDENT_REVISION_ID,
    }],
    revisions: [{
      revisionId: AP5_DEPENDENT_REVISION_ID,
      nodeId: AP5_DEPENDENT_NODE_ID,
      revisionNo: 1,
      title: "AP5 dependent specification",
      payload,
      origin: "import",
      claimStatus: "extracted",
      unknownReason: null,
      replacesRevisionId: null,
      contentDigestHex: createHash("sha256")
        .update(JSON.stringify(payload))
        .digest("hex"),
    }],
    evidence_links: [],
    // Направление принципиально: `from` зависит от `to`. Перепутать — значит
    // получить ребро, которого обход не увидит, и снова пустой прогон.
    edges: [{
      edgeId: AP5_DEPENDENT_EDGE_ID,
      fromNodeId: AP5_DEPENDENT_NODE_ID,
      toNodeId: AP5_DECISION_NODE_ID,
      relation: "depends_on",
    }],
    expected_state_revision: scope.stateRevision,
    idempotency_key: "ap5:ingest-dependent-spec",
  });
  if (ingest.error) {
    throw new Error(
      `AP5: ingest зависимого узла не прошёл: ${ingest.error.message}`
      + ` / ${ingest.error.details ?? "(без деталей)"}`,
    );
  }
  const mutation = ingest.data as {
    readonly result: { readonly ingestionId: string; readonly sourceId: string };
  };
  return { ingestionId: mutation.result.ingestionId, sourceId: mutation.result.sourceId };
}
