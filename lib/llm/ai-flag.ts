// AI выключен, пока явно не включён (решение владельца 01.10.2026 на время
// пилота): без отдельного основания данные анкет и планов не передаются ни
// одному AI-сервису. Включается только REMHAOS_AI_ENABLED=true — тогда же нужен
// конкретный провайдер, страна и отдельное согласие клиента.
export function isAiEnabled(value = process.env.REMHAOS_AI_ENABLED): boolean {
  return value === "true";
}

export const AI_DISABLED_ERROR = "ai_disabled";
