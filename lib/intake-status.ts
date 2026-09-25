// Бриф принимает ответы только пока проект не прошёл дальше заполнения.
// После brief_completed (и тем более после отправки/принятия КП) повторная
// отправка не должна ни откатывать статус, ни пересобирать карточки рисков,
// которые дизайнер уже принял (аудит 25.09.2026, BUG-02).
export const INTAKE_OPEN_STATUSES = ["created", "brief_sent", "brief_in_progress"] as const;

export function isIntakeOpen(status: string): boolean {
  return (INTAKE_OPEN_STATUSES as readonly string[]).includes(status);
}
