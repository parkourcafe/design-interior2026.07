import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Digital Asset Links для TWA (Google Play + RuStore). Отдаётся по адресу
// /.well-known/assetlinks.json (rewrite в next.config.mjs).
//
// Значения берём из env, чтобы заполнить без правки кода после сборки AAB:
//   ANDROID_PACKAGE_NAME   — напр. space.arhidom.twa
//   ANDROID_CERT_SHA256    — отпечаток(и) SHA-256, через запятую.
//                            ВАЖНО: нужны ОБА сертификата —
//                            Google Play App Signing И подписи RuStore,
//                            иначе адресная строка не скроется в одном из сторов.
//
// Пока env не заданы — отдаём пустой массив (валидный JSON, верификация ещё не
// пройдена). Формат: https://developers.google.com/digital-asset-links
export function GET() {
  const pkg = process.env.ANDROID_PACKAGE_NAME?.trim();
  const fingerprints = (process.env.ANDROID_CERT_SHA256 ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const statements =
    pkg && fingerprints.length
      ? [
          {
            relation: ["delegate_permission/common.handle_all_urls"],
            target: {
              namespace: "android_app",
              package_name: pkg,
              sha256_cert_fingerprints: fingerprints,
            },
          },
        ]
      : [];

  return NextResponse.json(statements, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    },
  });
}
