import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  readHandoff,
  AP5_DECISION_NODE_ID,
  AP5_DEPTH_CHAIN_LENGTH,
  AP5_WIDE_STAR_BATCH_SIZE,
  AP5_WIDE_STAR_LEAF_COUNT,
  ap5DepthChainEdgeId,
  ap5DepthChainNodeId,
  ap5DepthChainRevisionId,
  ap5WideStarEdgeId,
  ap5WideStarNodeId,
  ap5WideStarRevisionId,
} from "./ap5-env";
import { accessTokenFor, clientForToken } from "./rpc-session";

/**
 * Графовые фикстуры для звеньев 14/15 (V1 Impact coverage states, OWNER
 * REVIEW 12.08.2026, блокер 3): `partial_depth` и `blocked_result_limit`
 * доказываются на НАСТОЯЩЕЙ странице, но сам граф собирает не человек мышью —
 * его собрал бы ingest реального источника, будь он такого размера. Тот же
 * класс отступления, что уже принят и задокументирован для
 * `tests/ap5/dependent-node.ts`: вызов идёт РЕАЛЬНОЙ RPC (`ingest_source_graph`,
 * у неё нет HTTP-двери) токеном АРХИТЕКТОРА, не service role — она выдана
 * `authenticated` и отозвана у `service_role` (`20260717092000`), системная
 * identity её выполнить не может даже при желании.
 *
 * Расчёт влияния и рассмотрение по-прежнему идут настоящей системной RPC и
 * настоящей браузерной сессией — здесь собирается только предметная область
 * (узлы и рёбра), которую в живом проекте создал бы ingest настоящего
 * источника такого масштаба.
 */

interface NodeSpec {
  readonly nodeId: string;
  readonly kind: "source" | "deliverable";
  readonly stableKey: string;
  readonly currentRevisionId: string;
}

interface RevisionSpec {
  readonly revisionId: string;
  readonly nodeId: string;
  readonly revisionNo: number;
  readonly title: string;
  readonly payload: Record<string, unknown>;
  readonly origin: string;
  readonly claimStatus: string;
  readonly unknownReason: string | null;
  readonly replacesRevisionId: string | null;
  readonly contentDigestHex: string;
}

interface EdgeSpec {
  readonly edgeId: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly relation: string;
}

function revisionFor(
  nodeId: string,
  revisionId: string,
  title: string,
  bindingSourceId?: string,
): RevisionSpec {
  // Полезная нагрузка несёт nodeId — иначе много ревизий с одинаковым `{}`
  // получили бы одинаковый digest, а «разное содержимое» перестало бы быть
  // правдой. Для узла, несущего привязку источника (`kind: 'source'`),
  // payload ОБЯЗАН содержать `sourceId`, совпадающий с `source.sourceId`:
  // `ingest_source_graph` сверяет их и отвечает `SOURCE_REVISION_BINDING_INVALID`,
  // если полезная нагрузка ревизии этого не подтверждает (проверено на живом
  // стеке — без этого поля привязка не проходит ни при какой форме остального).
  const payload = bindingSourceId ? { nodeId, sourceId: bindingSourceId } : { nodeId };
  return {
    revisionId,
    nodeId,
    revisionNo: 1,
    title,
    payload,
    origin: "import",
    claimStatus: "extracted",
    unknownReason: null,
    replacesRevisionId: null,
    contentDigestHex: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
  };
}

interface IngestGraphOptions {
  readonly sourceId: string;
  readonly sourceRevisionId: string;
  readonly originalFilename: string;
  readonly nodes: readonly NodeSpec[];
  readonly revisions: readonly RevisionSpec[];
  readonly edges: readonly EdgeSpec[];
  readonly idempotencyKey: string;
}

async function ingestGraph(
  client: SupabaseClient,
  options: IngestGraphOptions,
): Promise<{ readonly ingestionId: string; readonly sourceId: string }> {
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

  const checksumHex = createHash("sha256").update(options.sourceId).digest("hex");

  const ingest = await client.schema("projectceo_api").rpc("ingest_source_graph", {
    project_id: handoff.projectId,
    source: {
      sourceId: options.sourceId,
      sourceRevisionId: options.sourceRevisionId,
      kind: "pdf",
      checksumHex,
      packageId: handoff.rootPackageId,
      metadata: {
        originalFilename: options.originalFilename,
        mediaType: "application/pdf",
        sizeBytes: 2048,
        extension: "pdf",
        sourceRole: "document",
        declaredRevision: null,
        documentStatus: "current",
      },
    },
    fragments: [],
    nodes: options.nodes,
    revisions: options.revisions,
    evidence_links: [],
    edges: options.edges,
    expected_state_revision: scope.stateRevision,
    idempotency_key: options.idempotencyKey,
  });
  if (ingest.error) {
    throw new Error(
      `AP5: ingest графовой фикстуры (${options.sourceId}) не прошёл: ${ingest.error.message}`
      + ` / ${ingest.error.details ?? "(без деталей)"}`,
    );
  }
  const mutation = ingest.data as {
    readonly result: { readonly ingestionId: string; readonly sourceId: string };
  };
  return { ingestionId: mutation.result.ingestionId, sourceId: mutation.result.sourceId };
}

/**
 * Цепочка длиной `AP5_DEPTH_CHAIN_LENGTH`, узел 1 зависит от решения, узел N
 * зависит от узла N-1. Обход глубже политики её полностью не найдёт —
 * `partial_depth`. Узел 1 несёт саму привязку источника (kind `source`),
 * остальные — обычные `deliverable`, как их создал бы ingest спецификаций,
 * ссылающихся друг на друга. Длина маленькая (одноразрядная) — умещается в
 * один вызов без риска по размеру запроса.
 */
export async function ingestDepthChain(): Promise<{ readonly sourceId: string }> {
  const client = clientForToken(await accessTokenFor("designer"));
  const sourceId = "ap5-depth-chain-source";
  const sourceRevisionId = ap5DepthChainRevisionId(1);

  const nodes: NodeSpec[] = [];
  const revisions: RevisionSpec[] = [];
  const edges: EdgeSpec[] = [];

  for (let step = 1; step <= AP5_DEPTH_CHAIN_LENGTH; step += 1) {
    const nodeId = ap5DepthChainNodeId(step);
    const revisionId = ap5DepthChainRevisionId(step);
    nodes.push({
      nodeId,
      kind: step === 1 ? "source" : "deliverable",
      stableKey: `depth-chain-${step}`,
      currentRevisionId: revisionId,
    });
    revisions.push(revisionFor(
      nodeId,
      revisionId,
      `AP5 depth chain step ${step}`,
      step === 1 ? sourceId : undefined,
    ));
    edges.push({
      edgeId: ap5DepthChainEdgeId(step),
      fromNodeId: nodeId,
      toNodeId: step === 1 ? AP5_DECISION_NODE_ID : ap5DepthChainNodeId(step - 1),
      relation: "depends_on",
    });
  }

  return ingestGraph(client, {
    sourceId,
    sourceRevisionId,
    originalFilename: "ap5-depth-chain.pdf",
    nodes,
    revisions,
    edges,
    idempotencyKey: "ap5:ingest-depth-chain",
  });
}

/**
 * Звезда из `AP5_WIDE_STAR_LEAF_COUNT` листьев, каждый напрямую зависит от
 * решения (глубина 1 у каждого — усечение по глубине здесь ни при чём).
 * Число найденного превышает лимит результата — `blocked_result_limit`.
 *
 * Батчами по `AP5_WIDE_STAR_BATCH_SIZE`, ПОСЛЕДОВАТЕЛЬНО (не параллельно):
 * один вызов на все листья разом был бы одним HTTP POST на несколько
 * мегабайт, размер которого этот стенд не гарантирует. Каждый батч
 * регистрирует СВОЙ синтетический «источник» (свой `sourceId`/checksum —
 * иначе второй батч получил бы `SOURCE_ALREADY_REGISTERED`) и первый лист
 * батча несёт эту привязку (kind `source`), остальные — `deliverable`.
 * Последовательность обязательна: `expected_state_revision` каждого батча
 * читается заново ПОСЛЕ того, как предыдущий батч зафиксировался.
 */
export async function ingestWideStar(): Promise<{ readonly batchCount: number }> {
  const client = clientForToken(await accessTokenFor("designer"));
  let batchCount = 0;
  for (let batchStart = 1; batchStart <= AP5_WIDE_STAR_LEAF_COUNT; batchStart += AP5_WIDE_STAR_BATCH_SIZE) {
    batchCount += 1;
    const batchEnd = Math.min(
      batchStart + AP5_WIDE_STAR_BATCH_SIZE - 1,
      AP5_WIDE_STAR_LEAF_COUNT,
    );
    const sourceId = `ap5-ws-source-${batchCount}`;
    const sourceRevisionId = ap5WideStarRevisionId(batchStart);

    const nodes: NodeSpec[] = [];
    const revisions: RevisionSpec[] = [];
    const edges: EdgeSpec[] = [];

    for (let leaf = batchStart; leaf <= batchEnd; leaf += 1) {
      const nodeId = ap5WideStarNodeId(leaf);
      const revisionId = ap5WideStarRevisionId(leaf);
      nodes.push({
        nodeId,
        kind: leaf === batchStart ? "source" : "deliverable",
        stableKey: `ws-${leaf}`,
        currentRevisionId: revisionId,
      });
      revisions.push(revisionFor(
        nodeId,
        revisionId,
        String(leaf),
        leaf === batchStart ? sourceId : undefined,
      ));
      edges.push({
        edgeId: ap5WideStarEdgeId(leaf),
        fromNodeId: nodeId,
        toNodeId: AP5_DECISION_NODE_ID,
        relation: "depends_on",
      });
    }

    await ingestGraph(client, {
      sourceId,
      sourceRevisionId,
      originalFilename: `ap5-wide-star-batch-${batchCount}.pdf`,
      nodes,
      revisions,
      edges,
      idempotencyKey: `ap5:ingest-wide-star:${batchCount}`,
    });
  }
  return { batchCount };
}
