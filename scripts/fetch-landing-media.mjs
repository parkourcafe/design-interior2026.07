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
  // Кинематографичный лендинг (список зеркалит components/landing/media.ts)
  "hf_20260705_184919_908ad4e0-2ddb-4200-9547-44b6e620f949.mp4", // hero video
  "hf_20260705_184650_ee7f3b53-914d-4c16-9ec0-a557dc063088.png", // hero poster
  "hf_20260705_184717_73928609-5d8c-4aa6-8096-7685d340a80f.png", // fog → structure
  "hf_20260705_184733_d3f69bfc-cf1d-4e47-b4e8-cbb6ba7eeb2b.png", // passport 4:5
  "hf_20260705_184735_1bbe87cf-1190-4df9-be64-6a3a190e5937.png", // risk cards
  "hf_20260705_184906_3f22541b-be52-4396-af0a-e303f271df14.png", // proposal
  "hf_20260705_184924_1d7e2d92-30ab-44dd-9502-46598fa4d369.png", // review board
  "hf_20260705_184929_3dcffd26-a517-47c4-bd21-94f11f52cf66.png", // client brief
  "hf_20260705_184935_f075f3be-c2c8-49ed-be61-5ef46c7d7647.png", // pricing
  "hf_20260705_184938_fecfdc7b-3289-4b96-8142-0de042e79e6b.png", // ownership
  "hf_20260705_184942_a268db01-67b8-4116-a5e6-5978c9cf2fbf.png", // data safety
  "hf_20260705_184947_9090187b-f7ee-420e-8f2d-fe96d2ca4718.png", // agenda
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
