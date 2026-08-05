import type { LayoutDocument } from "../../domain";

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
export class PrintExportAdapter {
  render(document: LayoutDocument, svg: string, metadata: Record<string, unknown>): string {
    const warnings = Array.isArray(metadata.warnings) ? metadata.warnings : [];
    const schedule = document.objects.map((item) => `<tr><td>${escape(item.id)}</td><td>${escape(item.label)}</td><td>${item.widthMm}×${item.depthMm}×${item.heightMm}</td></tr>`).join("");
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${escape(document.name)}</title><style>body{font:14px system-ui;color:#181818;margin:24px}svg{width:100%;max-height:60vh}table{width:100%;border-collapse:collapse}td,th{border:1px solid #aaa;padding:6px}@media print{button{display:none}}</style></head><body><h1>${escape(document.name)}</h1><p>Проект: ${escape(document.projectId)} · Вариант: ${escape(document.variant.label)} · Единицы: мм</p><p>Версия: ${escape(String(metadata.versionId ?? ""))} · SHA-256: ${escape(String(metadata.semanticHash ?? ""))}</p>${svg}<h2>Ведомость объектов</h2><table><thead><tr><th>ID</th><th>Наименование</th><th>Габариты, мм</th></tr></thead><tbody>${schedule}</tbody></table><h2>Предупреждения</h2><pre>${escape(JSON.stringify(warnings, null, 2))}</pre><p>Проектная модель ArchiDom. Перед строительством требуется проверка и утверждение человеком.</p></body></html>`;
  }
}
