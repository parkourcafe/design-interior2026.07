/**
 * Шаблон уведомления о выдаче выпуска (A7 / DEC-031).
 *
 * ЧТО МОЖНО ОТПРАВИТЬ В ГРУППУ — исчерпывающе:
 *
 *   * нейтральное название проекта;
 *   * факт появления новой версии;
 *   * кому требуется действие;
 *   * защищённую ссылку «Открыть в RemHaOS».
 *
 * ЧТО НЕЛЬЗЯ — и это не стиль, а требование A7:
 *
 *   * файл пакета;
 *   * signed URL;
 *   * чувствительные данные и бюджет;
 *   * внутренние идентификаторы;
 *   * право на действие.
 *
 * ПОСЛЕДНИЙ ПУНКТ ГЛАВНЫЙ. Ссылка ведёт на обычный защищённый экран проекта.
 * Открытие ссылки НИЧЕГО не подтверждает: сервер заново проверяет вход,
 * членство, область пакета, capability и актуальность выпуска, а
 * `acknowledge_release` выполняет получатель СВОЕЙ сессией отдельным явным
 * действием. Deep link — это навигация, а не полномочие.
 *
 * Внутренние идентификаторы в текст не попадают: получатель узнаёт проект по
 * ссылке, а не по UUID, и UUID в групповом чате — это утечка, которая ничего не
 * даёт взамен.
 */

import type { ClaimedNotification } from "./gateway-port";
import type { NotificationTemplate } from "./notification-runner";

export const RELEASE_TEMPLATE_ID = "release_distributed" as const;
export const RELEASE_TEMPLATE_VERSION = "0.1" as const;

/**
 * Защищённая ссылка на экран проекта. Обычная web-ссылка, без токенов и без
 * подписи: всё, что она делает, — приводит человека на экран, где сервер спросит
 * его заново.
 */
export function releaseDeepLink(appUrl: string, projectId: string): string {
  const base = appUrl.replace(/\/$/, "");
  return `${base}/dashboard/projectceo/projects/${projectId}`;
}

export function releaseNotificationTemplate(appUrl: string): NotificationTemplate {
  return {
    render(notification: ClaimedNotification) {
      if (notification.templateId !== RELEASE_TEMPLATE_ID) return null;

      const lines = [
        "RemHaOS: выпущена новая версия рабочей документации.",
        "",
        "Получателю нужно подтвердить получение в RemHaOS — сообщение в чате",
        "подтверждением не является.",
        "",
        `Открыть в RemHaOS: ${releaseDeepLink(appUrl, notification.projectId)}`,
      ];
      return { text: lines.join("\n") };
    },
  };
}
