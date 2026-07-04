// Скачивает медиа лендинга с CDN в public/landing, чтобы хостить их у себя.
// Запуск локально (не в песочнице, где внешний доступ закрыт):
//   npm run fetch:media
// Затем выставить в окружении: NEXT_PUBLIC_MEDIA_BASE=/landing
//
// Имена файлов сохраняются 1:1, поэтому ссылки в app/page.tsx менять не нужно —
// достаточно переменной окружения.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const CDN = "https://d8j0ntlcm91z4.cloudfront.net/user_3EKntK4EDjG8nay4H1dy1TK30mB";
const FILES = [
  "hf_20260703_075007_9a6ec60b-58b6-4d8a-a8b3-3ebaa80f5016.png", // hero (постер)
  "hf_20260703_061031_e3113877-b81b-42cf-a0cf-3826895023ef.png", // before
  "hf_20260703_061053_995c6a8f-96ce-4228-9ee0-20781ac42918.png", // after
  "hf_20260703_061105_084022de-7e46-4b47-a211-2d1b5e333399.png", // portrait
  "hf_20260703_080430_a9423e3f-803f-491f-bf4e-fee5c140e115.mp4", // hero video
];

const OUT = join(process.cwd(), "public", "landing");

async function main() {
  await mkdir(OUT, { recursive: true });
  let ok = 0;
  for (const name of FILES) {
    const url = `${CDN}/${name}`;
    process.stdout.write(`↓ ${name} … `);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(join(OUT, name), buf);
      console.log(`ок (${Math.round(buf.length / 1024)} КБ)`);
      ok++;
    } catch (e) {
      console.log(`ошибка: ${e.message}`);
    }
  }
  console.log(`\nГотово: ${ok}/${FILES.length} → public/landing`);
  console.log("Теперь выставьте NEXT_PUBLIC_MEDIA_BASE=/landing (в .env.local и на Vercel).");
  if (ok < FILES.length) process.exitCode = 1;
}

main();
