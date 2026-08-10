export interface PrintScheduleRow {
  /** Localized group name, e.g. "Стены". */
  group: string;
  entityId: string;
  label: string;
  /** Human-readable dimension summary in millimetres. */
  dimensions: string;
}

export interface PrintSummaryInput {
  documentId: string;
  versionId: string;
  semanticHash: string;
  warnings: readonly string[];
  schedule?: readonly PrintScheduleRow[];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function scheduleTable(rows: readonly PrintScheduleRow[]): string {
  if (rows.length === 0) return "<p>Ведомость пуста.</p>";
  const body = rows
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.group)}</td><td>${escapeHtml(row.entityId)}</td><td>${escapeHtml(
          row.label,
        )}</td><td>${escapeHtml(row.dimensions)}</td></tr>`,
    )
    .join("");
  return `<table><thead><tr><th>Группа</th><th>Идентификатор</th><th>Наименование</th><th>Габариты, мм</th></tr></thead><tbody>${body}</tbody></table>`;
}

/** Creates the standalone, print-safe summary for one immutable layout version. */
export function buildPrintSummary(input: PrintSummaryInput): string {
  const warnings = input.warnings.length
    ? `<ul>${input.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>`
    : "<p>Предупреждений нет.</p>";

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>ArchiDom — сводка версии ${escapeHtml(input.versionId)}</title><style>@media print{body{margin:16mm}table{page-break-inside:auto}tr{page-break-inside:avoid}}body{font-family:system-ui,sans-serif;line-height:1.45;color:#171717;max-width:900px;margin:32px auto;padding:0 24px}dt{font-weight:700}dd{margin:0 0 12px;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f3f1ea}.disclaimer{margin-top:32px;padding:16px;border:1px solid #999}</style></head><body><main><h1>Сводка планировки ArchiDom</h1><dl><dt>Документ</dt><dd>${escapeHtml(input.documentId)}</dd><dt>Опубликованная версия</dt><dd>${escapeHtml(input.versionId)}</dd><dt>Семантический хеш</dt><dd>${escapeHtml(input.semanticHash)}</dd></dl><h2>Ведомость элементов</h2>${scheduleTable(input.schedule ?? [])}<h2>Предупреждения</h2>${warnings}<p class="disclaimer"><strong>Важно:</strong> ArchiDom Layout Studio — прототип. Эта сводка не является строительной или рабочей документацией. Размеры и привязки необходимо проверить на площадке и согласовать с ответственными специалистами.</p></main></body></html>`;
}

export const createPrintSummary = buildPrintSummary;
