// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { TelegramChannelPanel } from "@/components/projectceo/telegram-channel-panel";
import { ru } from "@/lib/i18n/ru";

/**
 * Настоящий рендер настоящего компонента, а не проверка его исходника.
 *
 * Разница существенна: файл может содержать нужную строку и всё равно не
 * показывать кнопку — условие показа стоит в другом месте. Здесь панель
 * монтируется, отвечает на её собственный запрос состояния и получает
 * настоящий клик.
 *
 * Проверяется одно свойство и два состояния: незавершённое и приостановленное
 * подключение обязаны ОТКЛЮЧАТЬСЯ. Владелец, у которого уведомление не ушло
 * или бота понизили, иначе остаётся с чатом, который занят, ничего не
 * принимает и не отпускается: кнопки «подключить» уже нет (и правильно), а
 * кнопки «отключить» ещё нет.
 */

const strings = ru.telegramBridge;
const PROJECT_ID = "41111111-1111-4111-8111-111111111111";

interface PanelFetchLog {
  readonly disconnects: Array<Record<string, unknown>>;
}

function mountPanel(status: string): PanelFetchLog {
  const log: PanelFetchLog = { disconnects: [] };
  let current = status;

  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/integrations/telegram/channel?")) {
      return new Response(
        JSON.stringify({
          state: {
            provider: "telegram",
            identityLinked: true,
            canManage: true,
            binding: { status: current, captureState: "none" },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url === "/api/integrations/telegram/channel" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      if (body.action === "disconnect") {
        log.disconnects.push(body);
        current = "revoked";
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected panel call: ${url}`);
  });

  render(<TelegramChannelPanel projectId={PROJECT_ID} />);
  return log;
}

describe("Telegram channel panel", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("names the pending state instead of pretending the chat is not connected", async () => {
    mountPanel("notice_pending");
    await waitFor(() =>
      expect(screen.getByText(strings.status.noticePending)).toBeDefined(),
    );
    // Кнопки «подключить» здесь быть не должно: чат уже занят этим проектом, и
    // база ответила бы на неё отказом.
    expect(screen.queryByRole("button", { name: strings.actions.connect })).toBeNull();
  });

  for (const status of ["notice_pending", "suspended"] as const) {
    it(`disconnects a ${status} binding on a real click`, async () => {
      const log = mountPanel(status);
      const user = userEvent.setup();

      const button = await screen.findByRole("button", {
        name: strings.actions.disconnect,
      });
      await user.click(button);

      await waitFor(() => expect(log.disconnects).toHaveLength(1));
      expect(log.disconnects[0]).toMatchObject({
        action: "disconnect",
        projectId: PROJECT_ID,
      });
    });
  }
});
