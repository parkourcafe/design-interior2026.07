#!/usr/bin/env node
// Перенос файлов клиентов (бакет client-uploads) из старого проекта Supabase в
// новый — через Storage API обоих проектов, без прямой записи в storage.*.
// Пара к transfer.zsh (решение владельца 28.09: перенести аккаунты и проекты).
// Бакет firecrawl-raw (сборщик market_harvest) не переносится.
//
// Пути сохраняются как есть: answers.attachments в перенесённых проектах
// ссылаются на те же ключи. Уже существующий в приёмнике файл не
// перезаписывается (повторный запуск безопасен). Сверка — по размеру.
//
// Запуск (ключи service role не печатаются):
//   SOURCE_SUPABASE_URL=… SOURCE_SERVICE_ROLE_KEY=… \
//   TARGET_SUPABASE_URL=… TARGET_SERVICE_ROLE_KEY=… \
//   EXPECTED_FILE_COUNT=<число из вывода transfer.zsh> \
//     node scripts/cutover/transfer-files.mjs

const BUCKET = "client-uploads";

function env(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`не задан ${name}`);
    process.exit(1);
  }
  return value;
}

const source = { url: env("SOURCE_SUPABASE_URL").replace(/\/$/, ""), key: env("SOURCE_SERVICE_ROLE_KEY") };
const target = { url: env("TARGET_SUPABASE_URL").replace(/\/$/, ""), key: env("TARGET_SERVICE_ROLE_KEY") };

const headers = (side, extra = {}) => ({ apikey: side.key, Authorization: `Bearer ${side.key}`, ...extra });
const objectUrl = (side, path) =>
  `${side.url}/storage/v1/object/${BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;

async function list(side, prefix) {
  const files = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(`${side.url}/storage/v1/object/list/${BUCKET}`, {
      method: "POST",
      headers: headers(side, { "Content-Type": "application/json" }),
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: "name", order: "asc" } }),
    });
    if (!response.ok) throw new Error(`list ${prefix || "/"}: HTTP ${response.status}`);
    const page = await response.json();
    for (const entry of page) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) files.push(...(await list(side, path))); // папка
      else files.push({ path, size: Number(entry.metadata?.size ?? 0), type: entry.metadata?.mimetype });
    }
    // До пустой страницы, а не «меньше лимита»: сервер может отдавать меньше
    // 1000 записей за раз, и короткая первая страница не значит конец.
    if (page.length === 0) return files;
  }
}

const sourceFiles = await list(source, "");
// Сверка с базой: transfer.zsh печатает число файлов в storage.objects источника.
const expected = process.env.EXPECTED_FILE_COUNT?.trim();
if (expected !== undefined && expected !== "" && Number(expected) !== sourceFiles.length) {
  console.error(`список Storage API (${sourceFiles.length}) не совпадает с базой (${expected})`);
  process.exit(1);
}
const targetSizes = new Map((await list(target, "")).map((file) => [file.path, file.size]));
console.log(`== файлов в источнике: ${sourceFiles.length}`);

let copied = 0;
let skipped = 0;
for (const file of sourceFiles) {
  if (targetSizes.has(file.path)) {
    if (targetSizes.get(file.path) !== file.size) throw new Error(`размер отличается: ${file.path}`);
    skipped += 1;
    continue;
  }
  const download = await fetch(objectUrl(source, file.path), { headers: headers(source) });
  if (!download.ok) throw new Error(`download ${file.path}: HTTP ${download.status}`);
  const bytes = new Uint8Array(await download.arrayBuffer());
  const upload = await fetch(objectUrl(target, file.path), {
    method: "POST",
    headers: headers(target, { "Content-Type": file.type || "application/octet-stream", "x-upsert": "false" }),
    body: bytes,
  });
  if (!upload.ok) throw new Error(`upload ${file.path}: HTTP ${upload.status}`);
  copied += 1;
}

const after = new Map((await list(target, "")).map((file) => [file.path, file.size]));
const missing = sourceFiles.filter((file) => after.get(file.path) !== file.size);
console.log(`  скопировано: ${copied}, уже были: ${skipped}, расхождений: ${missing.length}`);
if (missing.length > 0) {
  for (const file of missing) console.log(`  FAIL ${file.path}`);
  process.exit(1);
}
console.log("FILES_TRANSFER_OK");
