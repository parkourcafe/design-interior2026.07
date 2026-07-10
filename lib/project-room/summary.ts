import type { ProjectTask } from "./types";

export interface AdminSummary { overdue: ProjectTask[]; blocked: ProjectTask[]; waitingClient: ProjectTask[]; waitingExecutor: ProjectTask[]; suggestions: string[] }

export function buildAdminSummary(tasks: ProjectTask[], today = new Date()): AdminSummary {
  const day = today.toISOString().slice(0, 10);
  const active = tasks.filter((task) => task.status !== "done");
  const overdue = active.filter((task) => task.due_date !== null && task.due_date < day);
  const blocked = active.filter((task) => task.status === "blocked");
  const waitingClient = active.filter((task) => task.status === "waiting_client");
  const waitingExecutor = active.filter((task) => task.status === "waiting_executor");
  const suggestions: string[] = [];
  if (overdue.length) suggestions.push(`Проверить просроченные задачи: ${overdue.length}.`);
  if (blocked.length) suggestions.push(`Уточнить причины блокировки: ${blocked.length}.`);
  if (waitingClient.length) suggestions.push(`Напомнить клиенту о задачах: ${waitingClient.length}.`);
  if (waitingExecutor.length) suggestions.push(`Уточнить статус у исполнителя: ${waitingExecutor.length}.`);
  if (!suggestions.length) suggestions.push("Критичных сигналов сейчас нет.");
  return { overdue, blocked, waitingClient, waitingExecutor, suggestions };
}
