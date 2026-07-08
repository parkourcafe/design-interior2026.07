import { ImageResponse } from "next/og";

export const dynamic = "force-static";

// Генерируем иконки приложения кодом (без бинарных файлов). Full-bleed угольный
// фон → безопасно и как "any", и как maskable (Android обрежет углы, контент в
// центральной safe-zone). Палитра бренда ARHIDOM: уголь · слоновая кость ·
// бронза · олива. Используется манифестом и как иконка в Google Play / RuStore.
export function GET(_req: Request, { params }: { params: { size: string } }) {
  const size = Math.min(1024, Math.max(48, Number(params.size) || 192));
  // Safe-zone для maskable: контент в центральных ~52% (углы отрежутся).
  const card = Math.round(size * 0.52);
  const gap = Math.round(size * 0.055);
  const line = Math.round(size * 0.05);

  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#14110d",
        }}
      >
        <div
          style={{
            width: card,
            height: card,
            borderRadius: Math.round(size * 0.11),
            background: "#ece4d4",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap,
            padding: Math.round(size * 0.11),
          }}
        >
          <div style={{ height: line, width: "62%", borderRadius: 999, background: "#8f6039" }} />
          <div style={{ height: line, width: "90%", borderRadius: 999, background: "#c08b5c" }} />
          <div style={{ height: line, width: "78%", borderRadius: 999, background: "#9aa07b" }} />
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
