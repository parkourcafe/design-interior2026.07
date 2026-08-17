import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Пять ролей AP5 — те же, что заводит `npm run provision:ap1`. Ключ и целевая
 * роль здесь не дублируют скрипт «на всякий случай», а связывают auth-identity
 * с ролью членства: скрипт членства не выдаёт (service role для human
 * operations запрещён), их раздаёт owner приглашениями уже в global-setup.
 */
export const AP5_ROLES = [
  { key: "owner", targetRole: null, membership: "owner_lead", uiRole: "owner" },
  { key: "designer", targetRole: "architect", membership: "architect", uiRole: "architect" },
  { key: "builder", targetRole: "builder", membership: "builder", uiRole: "builder" },
  // В членстве роль называется client_approver, в UI-контракте — client.
  { key: "client", targetRole: "client", membership: "client_approver", uiRole: "client" },
  // Гость намеренно остаётся без членства: он существует, чтобы доказать
  // deny-by-default у настоящей сессии, а не чтобы что-то делать.
  { key: "guest", targetRole: null, membership: null, uiRole: "guest" },
] as const;

export type Ap5RoleKey = (typeof AP5_ROLES)[number]["key"];

/**
 * Идентификаторы цепочки Kora. Живут здесь, а не в спеке, по двум причинам:
 * шаг 6 одобряет ровно ту ревизию, которую создал шаг 5, и оба значения обязаны
 * быть одним; и офлайновый гейт (`tests/projectceo-integration/
 * ap5-chain-identifiers.test.ts`) обязан прогонять их через настоящий
 * `projectCeoCommandSchema` — спеку Playwright из vitest не импортировать.
 *
 * Типы полей задаёт контракт команды (`command-contract.ts`), а не база:
 * `nodeId` — свободный текст до 160 символов, а `revisionId` у create_decision
 * — строго uuid («клиент генерирует UUID для новой ревизии»). База приняла бы
 * и текст, но команда до неё не доходит: маршрут отклоняет payload раньше.
 */
export const AP5_SOURCE_NAME = "ap5-floor-1-zone-a-architectural";
export const AP5_SOURCE_REVISION_ID = "ap5-source-revision-1";
export const AP5_DECISION_NODE_ID = "ap5-decision-floor-1";
export const AP5_DECISION_REVISION_ID = "a5d0c1c1-0000-4000-8000-000000000001";
/**
 * Вторая ревизия ТОГО ЖЕ решения — предпосылка заявки на изменение (звено 11).
 * Заявка требует расхождения между baseline: `submit_change_request` строит
 * корни изменения из пар «одна сущность, разные ревизии» и без единого корня
 * отвечает `NO_CHANGE_ROOTS`. Значит второй baseline обязан отличаться, а
 * отличаться он может только пересмотренным решением.
 */
export const AP5_DECISION_REVISION_ID_2 = "a5d0c1c1-0000-4000-8000-000000000002";

/**
 * Узел, ЗАВИСЯЩИЙ от решения, и ребро к нему.
 *
 * Влияние изменения идёт по ОБРАТНЫМ рёбрам графа: обход стартует от
 * изменённого узла и ищет рёбра, чей `toNodeId` — этот узел. Пока в цепочке
 * AP5 не было ни одного такого ребра, прогон влияния получался пустым, и
 * рассматривать архитектору было нечего — звено закрывалось пропуском.
 *
 * Ребро направлено `dependent --depends_on--> decision`: спецификация зависит
 * от решения, поэтому изменение решения её задевает. Это минимальная фигура,
 * дающая ровно одну карточку, — не «побольше данных», а ровно столько, сколько
 * нужно, чтобы цепочка стала доказуемой.
 */
export const AP5_DEPENDENT_SOURCE_ID = "ap5-dependent-spec";
export const AP5_DEPENDENT_NODE_ID = "ap5-node-dependent-spec";
export const AP5_DEPENDENT_REVISION_ID = "ap5-dependent-spec-revision-1";
export const AP5_DEPENDENT_EDGE_ID = "ap5-edge-dependent-spec-depends-on-decision";

/**
 * Третья и четвёртая ревизии решения — предпосылки заявок звеньев 13 и 14
 * (V1 Impact coverage states, OWNER REVIEW 12.08.2026, блокер 3). Та же
 * причина, что у `AP5_DECISION_REVISION_ID_2`: `submit_change_request` строит
 * корни из пар «одна сущность, разные ревизии», и без расхождения между
 * baseline корней не будет.
 */
export const AP5_DECISION_REVISION_ID_3 = "a5d0c1c1-0000-4000-8000-000000000003";
export const AP5_DECISION_REVISION_ID_4 = "a5d0c1c1-0000-4000-8000-000000000004";

/**
 * Глубокая цепочка для `partial_depth` (звено 13).
 *
 * Обход идёт по обратным рёбрам не глубже серверной политики (`maxDepth`,
 * сейчас 7). Цепочка длиной `AP5_DEPTH_CHAIN_LENGTH` узлов, каждый зависит от
 * предыдущего, а первый — от решения, даёт обход глубже политики: последние
 * звенья цепочки обход не найдёт. Число ЗАВЕДОМО больше текущей политики
 * (7 + запас), а не равно ей ровно — тест не обязан знать точное число
 * политики, только то, что она конечна.
 */
export const AP5_DEPTH_CHAIN_LENGTH = 9;
export function ap5DepthChainNodeId(step: number): string {
  return `ap5-node-depth-chain-${step}`;
}
export function ap5DepthChainRevisionId(step: number): string {
  return `ap5-depth-chain-${step}-revision-1`;
}
export function ap5DepthChainEdgeId(step: number): string {
  return `ap5-edge-depth-chain-${step}`;
}

/**
 * Широкая звезда для `blocked_result_limit` (звено 15).
 *
 * `knownImpactCountLowerBound` при блокировке — ВСЕГДА ровно `maxImpacts + 1`
 * (миграция `20260813010000`: `v_known_impact_count_lower_bound :=
 * v_max_impacts + 1`), не истинное число найденного, и порог побеждает
 * независимо от того, что ещё в этот момент есть в графе (звено 5б, звено 14
 * — DEC-034 отдаёт лимиту приоритет над глубиной). Значит для гарантии
 * достаточно листьев РОВНО в размер текущего лимита (`maxImpacts`, сейчас
 * 5000) — с узлом звена 5б это `maxImpacts + 1` найденных в любом случае,
 * без допущений о том, сколько из глубокой цепочки попадёт в пределы
 * политики. Точная граница (5000 не блокирует, 5001 блокирует) уже доказана
 * `tests/db5/29_impact_coverage_dec034.sql` — здесь же доказывается, что живая
 * страница показывает эту блокировку человеку, не точное число.
 *
 * Батчами по `AP5_WIDE_STAR_BATCH_SIZE`: один `ingest_source_graph` на все
 * листья разом — это один HTTP POST на несколько мегабайт, размер которого
 * ничем в этом стенде не гарантирован. Каждый батч регистрирует СВОЙ
 * синтетический «источник» — ровно так, как ingest реальных документов такого
 * объёма пришёл бы порциями, а не одним файлом.
 */
export const AP5_WIDE_STAR_LEAF_COUNT = 5000;
export const AP5_WIDE_STAR_BATCH_SIZE = 500;
export function ap5WideStarNodeId(leaf: number): string {
  return `ap5-ws-${leaf}`;
}
export function ap5WideStarRevisionId(leaf: number): string {
  return `ap5-ws-${leaf}-r1`;
}
export function ap5WideStarEdgeId(leaf: number): string {
  return `ap5-ws-${leaf}-e`;
}

/*
 * Идентификатор артефакта выпуска отсюда убран 11.08 вместе с psql-мостом:
 * артефакт собирает настоящий воркер (`npm run worker:release-artifacts`), и
 * идентификатор он выводит сам из версии. Знать его прогону незачем — а если
 * бы знал, осталось бы недоказанным, что воркер находит очередь сам.
 */

export const AP5_INVITED_ROLES = AP5_ROLES.filter(
  (role): role is Extract<typeof AP5_ROLES[number], { targetRole: string }> =>
    role.targetRole !== null,
);

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.includes("placeholder") || value.includes("your-")) {
    throw new Error(`AP5: не задан ${name}`);
  }
  return value;
}

export function ap5Env() {
  const domain = process.env.AP1_EMAIL_DOMAIN ?? "remhaos.test";
  return {
    appUrl: process.env.AP5_APP_URL ?? "http://127.0.0.1:3100",
    supabaseUrl: required("NEXT_PUBLIC_SUPABASE_URL"),
    anonKey: required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    // Нужен только чтобы выпустить magic link вместо почтового ящика — это
    // подмена доставки письма, а не выполнение операции за человека.
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
    emailFor: (key: Ap5RoleKey) => `${key}@ap1.${domain}`,
  };
}

const STATE_DIR = resolve(process.cwd(), "tests/ap5/.state");

export function statePath(name: string): string {
  return resolve(STATE_DIR, name);
}

export function storageStatePath(role: Ap5RoleKey): string {
  return statePath(`session-${role}.json`);
}

/** Что global-setup передаёт спекам: без него ни один тест не знает проекта. */
export type Ap5Handoff = {
  readonly projectId: string;
  /** Корневой пакет создаётся при регистрации проекта, его id равен projectId. */
  readonly rootPackageId: string;
  readonly userIds: Readonly<Record<string, string>>;
};

export function writeHandoff(handoff: Ap5Handoff): void {
  const file = statePath("handoff.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(handoff, null, 2)}\n`, "utf8");
}

export function readHandoff(): Ap5Handoff {
  return JSON.parse(readFileSync(statePath("handoff.json"), "utf8")) as Ap5Handoff;
}
