"use client";

import { useEffect, useState } from "react";

import {
  pickLayoutPlanSvg,
  svgToDataUri,
} from "@/lib/layout-studio/adapters/http/layout-plan-source";
import { ru } from "@/lib/i18n/ru";

const copy = ru.layoutStudio.thumbnail;

/**
 * Чертёж опубликованной версии на витрине согласования (§8.4).
 *
 * Клиент выбирает вариант по плану, а не по номеру ревизии — «то, чем
 * дизайнер продаёт себя». Компонент тонкий: сеть и кэш здесь, вся логика
 * выбора и отрисовки — в pickLayoutPlanSvg под тестами.
 *
 * SVG вставляется через data-URI в <img>, а не сырой разметкой в DOM:
 * содержимое приходит из подписанной версии, но витрина не обязана этому
 * доверять своим DOM-ом.
 *
 * Отказы тихие и честные: нет доступа, нет строки, не собрался чертёж —
 * подпись «план недоступен», витрина работает дальше словами.
 */

// Один запрос проекции на страницу: три карточки вариантов делят его между
// собой, а не ходят за одним и тем же трижды.
const projectionCache = new Map<string, Promise<unknown>>();

// Без packageId: клиент согласования — проектный актёр, и чтение с параметром
// пакета его scope отвергает. Проектное чтение отдаёт версии всех пакетов;
// нужная строка выбирается по layoutRevisionId.
async function fetchRows(projectId: string): Promise<unknown> {
  const key = projectId;
  let pending = projectionCache.get(key);
  if (!pending) {
    pending = fetch(
      `/api/projectceo/projects/${encodeURIComponent(projectId)}/layouts`,
      { credentials: "same-origin", cache: "no-store" },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as {
          data?: { m2LayoutVersions?: unknown } | null;
        };
        return body.data?.m2LayoutVersions ?? null;
      })
      .catch((error: unknown) => {
        // Провал не кэшируется: следующая карточка попробует заново.
        projectionCache.delete(key);
        throw error;
      });
    projectionCache.set(key, pending);
  }
  return pending;
}

export function LayoutPlanThumbnail({
  projectId,
  layoutRevisionId,
}: {
  readonly projectId: string;
  readonly layoutRevisionId: string;
}) {
  const [state, setState] = useState<
    { phase: "loading" } | { phase: "ready"; uri: string } | { phase: "unavailable" }
  >({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchRows(projectId)
      .then((rows) => {
        if (cancelled) return;
        const svg = pickLayoutPlanSvg(rows, layoutRevisionId);
        setState(svg ? { phase: "ready", uri: svgToDataUri(svg) } : { phase: "unavailable" });
      })
      .catch(() => {
        if (!cancelled) setState({ phase: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, layoutRevisionId]);

  if (state.phase === "loading") {
    return <span className="block text-xs text-muted">{copy.loading}</span>;
  }
  if (state.phase === "unavailable") {
    return <span className="block text-xs text-muted">{copy.unavailable}</span>;
  }
  return (
    // Обычный <img> сознательно: источник — data-URI, собранный из подписанной
    // версии; next/image здесь дал бы лишний прогон оптимизатора по данным,
    // которые и так локальны и уже минимальны.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={state.uri}
      alt={copy.alt}
      className="mt-2 block w-full rounded-lg border border-line bg-white"
    />
  );
}
