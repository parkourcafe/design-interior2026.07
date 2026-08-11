import { z } from "zod";

import { ru } from "@/lib/i18n/ru";

/**
 * Сборка текста уведомления.
 *
 * Версия шаблона хранится вместе с записью очереди (`template_version`).
 * Причина простая: сообщение уходит наружу и остаётся в чужом чате навсегда.
 * Когда через полгода спросят «а что именно бот тогда написал», ответом
 * должна быть версия шаблона, а не «текущий код».
 *
 * Что в сообщении есть: факт события и ссылка. Чего нет и не будет: состава
 * решений, сумм, имён участников и вложений. Мост уведомляет о событии, а
 * содержимое проекта живёт в RemHaOS за входом — A7 §1.7.
 *
 * Ссылка ведёт на обычную защищённую страницу. Никакого токена в ней нет:
 * ссылка в групповом чате видна всем участникам, и токен в ней означал бы
 * доступ по факту членства в чужой группе.
 */

export const NOTIFICATION_TEMPLATE_VERSION = "telegram-notice/1" as const;

export const releaseDistributedPayloadSchema = z.object({
  kind: z.literal("release_distributed"),
  projectId: z.string().min(1),
  versionLabel: z.string().min(1).max(80).optional(),
});

export interface RenderedNotification {
  readonly text: string;
}

function projectUrl(appBaseUrl: string, projectId: string): string {
  return `${appBaseUrl.replace(/\/$/, "")}/dashboard/projectceo/projects/${projectId}`;
}

/**
 * Возвращает null, если полезная нагрузка не той формы. Отправить «что-то» на
 * непонятной записи хуже, чем не отправить: в чужом чате не отзовёшь.
 */
export function renderNotification(input: {
  readonly templateVersion: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly appBaseUrl: string;
}): RenderedNotification | null {
  if (input.templateVersion !== NOTIFICATION_TEMPLATE_VERSION) return null;

  const parsed = releaseDistributedPayloadSchema.safeParse(input.payload);
  if (!parsed.success) return null;

  const strings = ru.telegramBridge.outbound;
  const label = parsed.data.versionLabel;
  const headline = label
    ? `${strings.releaseDistributed} (${label})`
    : strings.releaseDistributed;

  return {
    text: [
      headline,
      "",
      `${strings.openInRemhaos} ${projectUrl(input.appBaseUrl, parsed.data.projectId)}`,
    ].join("\n"),
  };
}

/** Уведомление о сборе данных, которое бот публикует в группе при подключении. */
export const GROUP_NOTICE_VERSION = "telegram-group-notice/1" as const;

export function renderGroupNotice(): string {
  return ru.telegramBridge.outbound.groupNotice;
}
