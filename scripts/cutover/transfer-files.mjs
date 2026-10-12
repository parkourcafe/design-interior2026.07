#!/usr/bin/env node
// Перенос файлов клиентов (бакет client-uploads) из старого проекта Supabase в
// новый — через Storage API обоих проектов, без прямой записи в storage.*.
// Пара к transfer.zsh (решение владельца 28.09: перенести аккаунты и проекты).
// Бакет firecrawl-raw (сборщик market_harvest) не переносится.
//
// Пути сохраняются как есть: answers.attachments в перенесённых проектах
// ссылаются на те же ключи. Уже существующий в приёмнике файл не
// перезаписывается (повторный запуск безопасен).
//
// Сверка — по содержимому (ТЗ 08.10, FIX-02): SHA-256 байтов, скачанных из
// источника, и байтов, скачанных из приёмника. Размер и ETag хранилища
// доказательством не считаются. Файл в приёмнике с другим содержимым — отказ
// с перечнем путей; скрипт его не перезаписывает (решает оператор). Итог
// FILES_TRANSFER_OK печатается только после повторной сверки всего набора.
//
// Запуск (ключи service role не печатаются):
//   SOURCE_SUPABASE_URL=… SOURCE_SERVICE_ROLE_KEY=… \
//   TARGET_SUPABASE_URL=… TARGET_SERVICE_ROLE_KEY=… \
//   EXPECTED_FILE_COUNT=<число из вывода transfer.zsh> \
//     node scripts/cutover/transfer-files.mjs

import { createHash } from "node:crypto";

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
const targetPaths = new Set((await list(target, "")).map((file) => file.path));
console.log(`== файлов в источнике: ${sourceFiles.length}`);

async function fetchBytes(side, path, label) {
  const response = await fetch(objectUrl(side, path), { headers: headers(side) });
  if (!response.ok) throw new Error(`${label} ${path}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const expectedHash = new Map();
const conflicts = [];
let copied = 0;
let verifiedExisting = 0;
for (const file of sourceFiles) {
  const bytes = await fetchBytes(source, file.path, "download");
  const hash = sha256(bytes);
  expectedHash.set(file.path, hash);
  if (!targetPaths.has(file.path)) {
    const upload = await fetch(objectUrl(target, file.path), {
      method: "POST",
      headers: headers(target, { "Content-Type": file.type || "application/octet-stream", "x-upsert": "false" }),
      body: bytes,
    });
    // «Уже существует» (409, или 400 с statusCode "409"/Duplicate в теле — так
    // отвечают версии Storage API): файл появился между списком и загрузкой —
    // сверяем ниже, как существующий. Любой другой отказ — ошибка загрузки.
    if (upload.ok) copied += 1;
    else {
      const reason = await upload.text().catch(() => "");
      const duplicate = upload.status === 409
        || (upload.status === 400 && /"statusCode"\s*:\s*"409"|Duplicate|already exists/i.test(reason));
      if (!duplicate) throw new Error(`upload ${file.path}: HTTP ${upload.status} ${reason.slice(0, 200)}`);
    }
  }
  const stored = sha256(await fetchBytes(target, file.path, "verify"));
  if (stored !== hash) conflicts.push({ path: file.path, source: hash, target: stored });
  else if (targetPaths.has(file.path)) verifiedExisting += 1;
}

// Повторная сверка всего набора перед итогом: каждый файл источника есть в
// приёмнике с тем же SHA-256.
const finalMismatch = [];
for (const file of sourceFiles) {
  if (conflicts.some((c) => c.path === file.path)) continue;
  const stored = sha256(await fetchBytes(target, file.path, "final-verify"));
  if (stored !== expectedHash.get(file.path)) finalMismatch.push(file.path);
}
console.log(`  скопировано: ${copied}, уже были (содержимое совпало): ${verifiedExisting}, конфликтов: ${conflicts.length + finalMismatch.length}`);
if (conflicts.length > 0 || finalMismatch.length > 0) {
  for (const c of conflicts) {
    console.log(`  CONFLICT ${c.path} источник sha256=${c.source.slice(0, 16)}… приёмник sha256=${c.target.slice(0, 16)}…`);
  }
  for (const path of finalMismatch) console.log(`  FAIL ${path} (не совпало при итоговой сверке)`);
  console.log("FILES_TRANSFER_FAILED: файлы в приёмнике отличаются от источника и не перезаписаны.");
  console.log("Проверьте их вручную; после удаления ошибочных копий в приёмнике запуск можно повторить.");
  process.exit(2);
}
console.log(`  сверено по SHA-256: ${sourceFiles.length} из ${sourceFiles.length}`);
console.log("FILES_TRANSFER_OK");
