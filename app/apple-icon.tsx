import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";
export const dynamic = "force-static";

// Apple touch icon (iOS «на экран «Домой»»). Только фигуры — без шрифтов.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 180,
          height: 180,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#14110d",
        }}
      >
        <div
          style={{
            width: 118,
            height: 118,
            borderRadius: 22,
            background: "#ece4d4",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 9,
            padding: 25,
          }}
        >
          <div style={{ height: 10, width: "62%", borderRadius: 999, background: "#8f6039" }} />
          <div style={{ height: 8, width: "90%", borderRadius: 999, background: "#c08b5c" }} />
          <div style={{ height: 8, width: "80%", borderRadius: 999, background: "#9aa07b" }} />
        </div>
      </div>
    ),
    size,
  );
}
