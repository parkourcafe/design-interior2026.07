// Ответ клиента на публичное КП (без миграций): фиксируется событием.
// Общие константы для API-роута, публичной страницы и кабинета дизайнера.

export const ACTION_EVENT: Record<string, string> = {
  accept: "proposal_accepted",
  discuss: "proposal_discussion_requested",
  changes: "proposal_changes_requested",
};

export const RESPONSE_TYPES = Object.values(ACTION_EVENT);
