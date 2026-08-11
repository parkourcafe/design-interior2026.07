/**
 * Настройки проекта → интеграции (A7 / DEC-031, гейт TG2).
 *
 * Отдельный маршрут, а не вкладка рабочего пространства: подключение канала —
 * настройка проекта, а не работа над ним, и жить ей рядом с решениями и
 * версиями незачем.
 *
 * ВЫКЛЮЧЕННЫЙ МОСТ ОТВЕЧАЕТ `404`, а не пустой страницей с объяснением. Тот же
 * приём, что у M3 (DEC-028): при выключенном модуле его поверхности не
 * существует в ответе сервера, а не «существует, но пустая».
 */

import { notFound } from "next/navigation";

import { TelegramChannelPanel } from "@/components/projectceo/telegram-channel-panel";
import { resolveTelegramBridgeConfig } from "@/lib/integration-gateway/telegram/bridge-flag";
import { TelegramHumanPort } from "@/lib/integration-gateway/telegram/gateway-port";
import { createProjectCeoRequestContext } from "@/lib/project-intelligence/delivery/projectceo/request-context";
import { ru } from "@/lib/i18n/ru";

export const dynamic = "force-dynamic";

export default async function ProjectIntegrationsPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  if (!resolveTelegramBridgeConfig().ok) notFound();

  const context = await createProjectCeoRequestContext();
  const port = new TelegramHumanPort(context.client);

  // Право проверяет сервер, а не экран: `get_project_channel_state` требует
  // `manage_project_integrations`, и отказ приходит из базы. Показывать
  // «недостаточно прав» вместо `404` значило бы подтвердить существование
  // чужого проекта.
  const state = await port.getChannelState(projectId).catch(() => null);
  if (!state) notFound();

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900">
        {ru.telegramBridge.panel.title}
      </h1>
      <TelegramChannelPanel projectId={projectId} state={state} />
    </main>
  );
}
