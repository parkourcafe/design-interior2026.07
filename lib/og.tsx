import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { ru } from "@/lib/i18n/ru";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

// Кириллический шрифт читаем с диска лениво и кешируем (файлы — в app/_fonts/,
// включены в трассировку через outputFileTracingIncludes в next.config.mjs).
// Golos Text уже используется в layout; берём статические срезы 600 (SemiBold)
// для кириллицы и латиницы — заголовки смешанные (ARHIDOM / CRM / Excel + русский).
// Ленивое чтение внутри функции (а не на верхнем уровне модуля) — чтобы импорт
// модуля был безопасным для роутов, которые тянут его в общий чанк.
let fonts: [Buffer, Buffer] | null = null;
function loadFonts(): [Buffer, Buffer] {
  if (!fonts) {
    const dir = join(process.cwd(), "app", "_fonts");
    fonts = [
      readFileSync(join(dir, "GolosText-SemiBold-cyrillic.woff")),
      readFileSync(join(dir, "GolosText-SemiBold-latin.woff")),
    ];
  }
  return fonts;
}

export async function ogImage(opts: { title: string; eyebrow?: string }) {
  const { title, eyebrow = ru.app.name } = opts;
  const [cyrillicFont, latinFont] = loadFonts();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          background: "#14110d",
          color: "#f4efe7",
          fontFamily: "Golos",
        }}
      >
        <div style={{ display: "flex", fontSize: 32, letterSpacing: 3, opacity: 0.75 }}>
          {eyebrow.toUpperCase()}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 66,
            lineHeight: 1.12,
            fontWeight: 600,
            maxWidth: 1000,
          }}
        >
          {title}
        </div>
        <div style={{ display: "flex", fontSize: 30, opacity: 0.7 }}>{ru.app.tagline}</div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: "Golos", data: cyrillicFont, style: "normal", weight: 600 },
        { name: "Golos", data: latinFont, style: "normal", weight: 600 },
      ],
    },
  );
}
