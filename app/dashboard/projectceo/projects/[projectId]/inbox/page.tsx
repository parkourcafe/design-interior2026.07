/**
 * Project Inbox проекта (A7 / DEC-031, гейт TG3).
 *
 * Страница собирает ДВА чтения, и оба существующие: кандидатов отдаёт шлюз,
 * предпосылку команды изменения — та же проекция рабочего пространства, что
 * питает вкладку «Изменения». Второе чтение нужно ровно затем, чтобы форма не
 * предлагалась там, где команда всё равно откажет: действие, которого нельзя
 * выполнить, предлагать нельзя (A6 §4.2.5).
 *
 * ВЫКЛЮЧЕННЫЙ МОСТ ОТВЕЧАЕТ `404`, а не пустой страницей: при выключенном
 * контуре его поверхности не существует в ответе сервера.
 */

import { notFound } from "next/navigation";

import { ProjectInboxPanel } from "@/components/projectceo/project-inbox-panel";
import { resolveTelegramBridgeConfig } from "@/lib/integration-gateway/telegram/bridge-flag";
import { TelegramHumanPort } from "@/lib/integration-gateway/telegram/gateway-port";
import { createProjectCeoRequestContext } from "@/lib/project-intelligence/delivery/projectceo/request-context";
import { createProjectCeoServerPort } from "@/lib/project-intelligence/delivery/projectceo/server-port";
import { ru } from "@/lib/i18n/ru";

export const dynamic = "force-dynamic";

export default async function ProjectInboxPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  if (!resolveTelegramBridgeConfig().ok) notFound();

  const context = await createProjectCeoRequestContext();
  const port = new TelegramHumanPort(context.client);
  const candidates = await port.listInboxCandidates({ projectId, maxRows: 100 })
    .catch(() => null);
  if (!candidates) notFound();

  const workspace = await createProjectCeoServerPort()
    .then((serverPort) => serverPort.getProjectWorkspace({
      projectId,
      requestId: crypto.randomUUID(),
    }))
    .catch(() => null);

  const changeOperation = workspace?.data?.operations.create_change;
  const changeTargetVersionId = changeOperation?.status === "available"
    ? changeOperation.commandTargetId ?? null
    : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900">
        {ru.telegramBridge.inbox.title}
      </h1>
      <ProjectInboxPanel
        projectId={projectId}
        candidates={candidates}
        changeTargetVersionId={changeTargetVersionId}
      />
    </main>
  );
}
