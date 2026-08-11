import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  classifyMessage,
  EXTRACTION_SCHEMA_VERSION,
} from "../../lib/integration-gateway/telegram/extraction/classifier";
import {
  runChannelExtractionBatch,
  type ChannelExtractionPort,
  type ClaimedChannelEvent,
} from "../../lib/integration-gateway/telegram/extraction/runner";
import {
  releaseNotificationIdempotencyKey,
  runDistributionProjection,
} from "../../lib/integration-gateway/telegram/distribution-projector";
import type { TelegramSystemPort } from "../../lib/integration-gateway/telegram/channel-port";
import { NOTIFICATION_TEMPLATE_VERSION } from "../../lib/integration-gateway/telegram/notification-template";

const repoRoot = process.cwd();
const read = (path: string): string => readFileSync(join(repoRoot, path), "utf8");

describe("Message classifier", () => {
  it("never turns chat text into an official action", () => {
    // A7 §1.7: «получил» в чате не выполняет `acknowledge_release`. Самое
    // опасное сообщение — то, которое ЗВУЧИТ как подтверждение.
    for (const text of [
      "подтверждаю получение пакета",
      "принимаю работу",
      "согласовано",
      "/acknowledge_release",
      "утверждаю замену",
    ]) {
      const result = classifyMessage({ text, attachmentCount: 0 });
      // Что бы ни решило правило, вид кандидата остаётся кандидатом: в перечне
      // видов нет ни приёмки, ни утверждения.
      expect(
        ["question", "decision_candidate", "change_request_candidate", "risk_candidate", "general_note", null],
        text,
      ).toContain(result === null ? null : result.kind);
    }
  });

  it("recognises a substitution as a change candidate", () => {
    // Замена материала — самое дорогое сообщение на стройке и первое, ради
    // которого строится контур M3 → M4.
    for (const text of [
      "Плитки нет в наличии, поставим аналог",
      "Вместо дуба привезли ясень",
      "Этот смеситель сняли с производства",
    ]) {
      expect(classifyMessage({ text, attachmentCount: 0 })?.kind, text)
        .toBe("change_request_candidate");
    }
  });

  it("recognises a schedule or quality problem as a risk candidate", () => {
    for (const text of ["Не успеваем к пятнице", "На стяжке трещина", "Задержка поставки"]) {
      expect(classifyMessage({ text, attachmentCount: 0 })?.kind, text).toBe("risk_candidate");
    }
  });

  it("stays silent on acknowledgements and empty messages", () => {
    // Классификатор, который на всё отвечает «предложение», превращает Inbox в
    // свалку — и человек перестаёт его читать. Тогда граница «предложено ≠
    // утверждено» рушится не запретом, а усталостью.
    for (const text of ["ок", "Ок.", "принял", "да", "+", "спасибо", "хорошо"]) {
      expect(classifyMessage({ text, attachmentCount: 0 }), text).toBeNull();
    }
    expect(classifyMessage({ text: "", attachmentCount: 0 })).toBeNull();
    expect(classifyMessage({ text: null, attachmentCount: 0 })).toBeNull();
    expect(classifyMessage({ text: undefined, attachmentCount: 0 })).toBeNull();
  });

  it("describes an attachment without pretending to have read it", () => {
    // OCR и распознавание вне P0. Честный вид — заметка о числе вложений.
    const result = classifyMessage({ text: "", attachmentCount: 3 });
    expect(result?.kind).toBe("general_note");
    expect(result?.confidence).toBe("low");
    expect(result?.summary).toContain("3");
  });

  it("never claims high confidence, because a rule sees a word not an intent", () => {
    const samples = [
      "Плитки нет в наличии",
      "Не успеваем",
      "Как быть с розетками?",
      "Привезли материалы",
    ];
    for (const text of samples) {
      const result = classifyMessage({ text, attachmentCount: 0 });
      expect(result?.confidence, text).not.toBe("high");
    }
  });

  it("keeps the summary inside the column limit, cut on a word boundary", () => {
    const long = `${"поставка ".repeat(400)}вместо`;
    const result = classifyMessage({ text: long, attachmentCount: 0 });
    expect(result).not.toBeNull();
    expect(result!.summary.length).toBeLessThanOrEqual(2000);
    // Полуслово в карточке читается как ошибка системы, а не как длинное
    // сообщение. Проверяется именно граница слова: символ исходного текста
    // сразу за обрезкой обязан быть пробелом.
    const body = result!.summary.replace(/…$/, "");
    const collapsed = long.replace(/\s+/g, " ").trim();
    expect(collapsed.startsWith(body)).toBe(true);
    expect([" ", ""]).toContain(collapsed.slice(body.length, body.length + 1));
  });

  it("carries a schema version, so a later model is distinguishable", () => {
    expect(EXTRACTION_SCHEMA_VERSION).toBe("telegram-extraction/1");
  });
});

describe("Extraction runner", () => {
  interface Recorded {
    readonly candidates: { readonly eventId: string; readonly kind: string }[];
    readonly completed: { readonly eventId: string; readonly outcome: string }[];
  }

  const event = (over: Partial<ClaimedChannelEvent> = {}): ClaimedChannelEvent => ({
    eventId: "e1",
    projectId: "41111111-1111-4111-8111-111111111111",
    eventKind: "message",
    attemptCount: 1,
    externalMessageId: 1,
    externalSenderId: 777,
    payload: { kind: "message", text: "Плитки нет в наличии", attachmentCount: 0 },
    ...over,
  });

  const fakePort = (
    claimed: readonly ClaimedChannelEvent[],
    recorded: Recorded,
    failRecord = false,
  ): ChannelExtractionPort => ({
    claimChannelEvents: async () => claimed,
    recordInboxCandidate: async (input) => {
      if (failRecord) throw new Error("boom");
      recorded.candidates.push({ eventId: input.eventId, kind: input.candidateKind });
      return { created: true };
    },
    completeChannelEvent: async (input) => {
      recorded.completed.push({ eventId: input.eventId, outcome: input.outcome });
    },
  });

  const fresh = (): Recorded => ({ candidates: [], completed: [] });

  it("is a safe no-op on an empty queue", async () => {
    const recorded = fresh();
    const result = await runChannelExtractionBatch(fakePort([], recorded));
    expect(result).toEqual({ claimed: 0, candidates: 0, ignored: 0, failed: 0 });
  });

  it("always closes the event it claimed", async () => {
    // Незакрытое событие висит в `processing` до истечения лизы. Один
    // невозвращённый ответ — и очередь тормозит на минуту без причины.
    const recorded = fresh();
    await runChannelExtractionBatch(
      fakePort([event(), event({ eventId: "e2", payload: { kind: "message", text: "ок" } })], recorded),
    );
    expect(recorded.completed.map((entry) => entry.eventId).sort()).toEqual(["e1", "e2"]);
  });

  it("marks an unusable message ignored rather than inventing a candidate", async () => {
    const recorded = fresh();
    const result = await runChannelExtractionBatch(
      fakePort([event({ payload: { kind: "message", text: "ок", attachmentCount: 0 } })], recorded),
    );
    expect(result.ignored).toBe(1);
    expect(recorded.candidates).toEqual([]);
    expect(recorded.completed[0]?.outcome).toBe("ignored");
  });

  it("does not let one bad event take down the batch", async () => {
    const recorded = fresh();
    const result = await runChannelExtractionBatch(
      fakePort([event(), event({ eventId: "e2" })], recorded, true),
    );
    expect(result.failed).toBe(2);
    // Оба события закрыты как `failed`; решение о dead_letter принимает база
    // по счётчику попыток, а не разборщик.
    expect(recorded.completed.every((entry) => entry.outcome === "failed")).toBe(true);
  });

  it("survives a payload that is not the shape it expects", async () => {
    const recorded = fresh();
    const result = await runChannelExtractionBatch(
      fakePort([event({ payload: { unexpected: true } })], recorded),
    );
    // Нет текста и нет вложений — предлагать нечего, это `ignored`, не отказ.
    expect(result.ignored + result.failed).toBe(1);
    expect(recorded.completed).toHaveLength(1);
  });

  it("stamps every candidate with rule provenance, never ai", async () => {
    // `origin` — то, по чему человек понимает, откуда взялось предложение.
    // Классификатор детерминированный, и называть его AI было бы неправдой.
    const recorded: { readonly origins: string[] } = { origins: [] };
    const port: ChannelExtractionPort = {
      claimChannelEvents: async () => [event()],
      recordInboxCandidate: async (input) => {
        recorded.origins.push(input.origin);
        expect(input.extractionSchemaVersion).toBe(EXTRACTION_SCHEMA_VERSION);
        return { created: true };
      },
      completeChannelEvent: async () => {},
    };
    await runChannelExtractionBatch(port);
    expect(recorded.origins).toEqual(["rule"]);
  });
});

describe("Distribution projector", () => {
  const backlogItem = (over: Record<string, unknown> = {}) => ({
    projectId: "41111111-1111-4111-8111-111111111111",
    distributionId: "d1",
    versionLabel: "v3",
    ...over,
  });

  const fakePort = (
    backlog: readonly Record<string, unknown>[],
    outcomes: readonly { readonly queued: boolean; readonly reason: string | null }[],
    seen: Record<string, unknown>[],
  ): TelegramSystemPort =>
    ({
      listDistributionNotificationBacklog: async () => backlog,
      enqueueNotification: async (input: Record<string, unknown>) => {
        seen.push(input);
        return outcomes[seen.length - 1] ?? { queued: true, reason: null };
      },
    }) as unknown as TelegramSystemPort;

  it("is a safe no-op when nothing is waiting", async () => {
    const seen: Record<string, unknown>[] = [];
    const result = await runDistributionProjection(fakePort([], [], seen));
    expect(result).toEqual({ scanned: 0, queued: 0, alreadyQueued: 0, skippedNoBinding: 0 });
    expect(seen).toEqual([]);
  });

  it("derives the idempotency key from the distribution alone", () => {
    // Ключ обязан быть одним и тем же на повторных проходах — иначе проектор
    // при каждом запуске ставил бы в очередь новую копию.
    expect(releaseNotificationIdempotencyKey("d1")).toBe("release_distributed:d1");
    expect(releaseNotificationIdempotencyKey("d1")).toBe(
      releaseNotificationIdempotencyKey("d1"),
    );
    expect(releaseNotificationIdempotencyKey("d2")).not.toBe(
      releaseNotificationIdempotencyKey("d1"),
    );
  });

  it("tells apart a duplicate from a chat that went away", async () => {
    // Складывать их в один счётчик значило бы не считать ничего: «уже стояло»
    // — норма, «связь пропала» — повод посмотреть.
    const seen: Record<string, unknown>[] = [];
    const result = await runDistributionProjection(
      fakePort(
        [backlogItem(), backlogItem({ distributionId: "d2" }), backlogItem({ distributionId: "d3" })],
        [
          { queued: true, reason: null },
          { queued: false, reason: null },
          { queued: false, reason: "no_active_binding" },
        ],
        seen,
      ),
    );
    expect(result).toEqual({ scanned: 3, queued: 1, alreadyQueued: 1, skippedNoBinding: 1 });
  });

  it("sends the version label only when the domain actually has one", async () => {
    const seen: Record<string, unknown>[] = [];
    await runDistributionProjection(
      fakePort([backlogItem({ versionLabel: null })], [{ queued: true, reason: null }], seen),
    );
    const payload = seen[0]?.payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty("versionLabel");
    expect(payload.kind).toBe("release_distributed");
    expect(seen[0]?.templateVersion).toBe(NOTIFICATION_TEMPLATE_VERSION);
  });
});

/**
 * То, что обязано держаться по построению. Каждый пункт — про границу, которую
 * нельзя проверить, глядя на один экран кода.
 */
describe("Vertical invariants", () => {
  const inboxMigration = read(
    "supabase/migrations/20260811060000_remhaos_channel_bridge_inbox.sql",
  );
  const projector = read("lib/integration-gateway/telegram/distribution-projector.ts");
  const inboxRoute = read("app/api/integrations/telegram/inbox/route.ts");

  it("keeps the projector out of the module's command path", () => {
    // A7 §2.1: Telegram-кода внутри M1–M4 нет. Проектор ЧИТАЕТ сохранённое
    // состояние — команда `distribute_release` о мосте не знает.
    expect(projector).not.toContain("distribute_release(");
    expect(projector).toContain("listDistributionNotificationBacklog");
    for (const modulePath of [
      "supabase/migrations/20260717101000_projectceo_product_brain_operations.sql",
      "supabase/migrations/20260717102000_projectceo_m4_execution_persistence.sql",
    ]) {
      expect(read(modulePath), modulePath).not.toContain("remhaos_channel");
    }
  });

  it("gives the bridge no door that creates a domain object", () => {
    // Ни одна функция миграции не зовёт команду домена. Кандидат остаётся
    // кандидатом; изменение создаёт человек своей командой.
    for (const forbidden of [
      "projectceo_product_api.",
      "projectceo_m4_api.",
      "projectceo_m3_api.",
      "project_intelligence_api.",
    ]) {
      expect(inboxMigration, forbidden).not.toContain(forbidden);
    }
    // Читать состояние M4 мост может — писать в него нет.
    expect(inboxMigration).toContain("from projectceo_product.release_distributions");
    expect(inboxMigration).not.toMatch(/(insert into|update)\s+projectceo_(product|m4)\./);
  });

  it("refuses a human origin on the system door", () => {
    // Человек оставляет решение своей сессией. Дверь разборщика, принимающая
    // `human`, позволила бы системе расписаться за человека.
    expect(inboxMigration).toContain("if origin not in ('ai', 'rule') then");
  });

  it("forbids an official trace on a rejected candidate", () => {
    expect(inboxMigration).toContain(
      "if decision = 'reject' and resulting_entity_id is not null then",
    );
  });

  it("keeps the inbox route human-only", () => {
    expect(inboxRoute).toContain("TelegramInboxPort");
    expect(inboxRoute).not.toContain("TelegramSystemPort");
    expect(inboxRoute).not.toContain("createAdminClient");
  });

  it("says out loud, in the interface, that a candidate is not a decision", () => {
    // Граница держится не только правами: человек читает её раньше, чем
    // нажимает кнопку.
    const strings = read("lib/i18n/ru.ts");
    expect(strings).toContain("пока вы не подтвердите его своей");
    const panel = read("components/projectceo/telegram-inbox-panel.tsx");
    expect(panel).toContain("strings.subtitle");
    expect(panel).toContain("strings.confirmHint");
    // Панель без кириллицы в литералах: строки живут в словаре.
    const withoutComments = panel
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(withoutComments).not.toMatch(/["'`][^"'`]*[а-яА-ЯёЁ][^"'`]*["'`]/);
  });
});
