import { ImageResponse } from "next/og";

export const dynamic = "force-static";

// Генерируем иконки приложения кодом (без бинарных файлов). Только фигуры —
// шрифты не нужны, поэтому рендер надёжный. Терракотовый фон + «карточка».
export function GET(_req: Request, { params }: { params: { size: string } }) {
  const size = Math.min(1024, Math.max(48, Number(params.size) || 192));
  const pad = Math.round(size * 0.18);
  const cardW = size - pad * 2;

  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#9c4a28",
        }}
      >
        <div
          style={{
            width: cardW,
            height: cardW,
            borderRadius: Math.round(size * 0.12),
            background: "#faf9f6",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: Math.round(size * 0.05),
            padding: Math.round(size * 0.14),
          }}
        >
          <div style={{ height: Math.round(size * 0.055), width: "70%", borderRadius: 999, background: "#7a3a5a" }} />
          <div style={{ height: Math.round(size * 0.045), width: "90%", borderRadius: 999, background: "#e5e2dc" }} />
          <div style={{ height: Math.round(size * 0.045), width: "80%", borderRadius: 999, background: "#e5e2dc" }} />
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
