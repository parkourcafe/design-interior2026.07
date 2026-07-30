import {
  ProjectCeoGuestLinkError,
  readProjectCeoGuestRelease,
  type GuestReleaseProjection,
} from "@/lib/project-intelligence/delivery/projectceo/guest-link";

export const dynamic = "force-dynamic";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Content-Type": "text/html; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

function escapeHtml(value: string | number | boolean): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function documentShell(title: string, body: string): string {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #14110d; color: #f7f2ea; }
    main { box-sizing: border-box; width: min(760px, 100%); min-height: 100vh; margin: auto; padding: 48px 20px; }
    article { border: 1px solid #433a30; border-radius: 24px; background: #1d1914; padding: clamp(24px, 5vw, 40px); }
    h1 { margin: 0 0 10px; font-size: clamp(28px, 5vw, 42px); }
    p { color: #c9bdae; line-height: 1.6; }
    dl { display: grid; grid-template-columns: minmax(130px, 0.45fr) 1fr; gap: 12px 20px; margin: 28px 0 0; }
    dt { color: #a99b89; }
    dd { margin: 0; overflow-wrap: anywhere; }
    @media (max-width: 560px) { dl { grid-template-columns: 1fr; gap: 4px; } dd { margin-bottom: 14px; } }
  </style>
</head>
<body><main>${body}</main></body>
</html>`;
}

function releaseDocument(projection: GuestReleaseProjection): string {
  const rows: ReadonlyArray<readonly [string, string | number | boolean]> = [
    ["Проект", projection.projectId],
    ["Пакет", projection.package.name],
    ["ID пакета", projection.package.id],
    ["Ключ пакета", projection.package.stableKey],
    ["Тип пакета", projection.package.kind],
    ["Версия", projection.release.versionNo],
    ["ID версии", projection.release.versionId],
    ["Контрольная сумма", projection.release.graphDigest],
    ["Опубликовано", projection.release.publishedAt],
    ["Ссылка действует до", projection.expiresAt],
    ["Подтверждение доступно", projection.allowAcknowledgement],
  ];

  return documentShell(
    "Выпуск проекта — RemHaOS",
    `<article>
      <p>RemHaOS · гостевой доступ</p>
      <h1>Выпуск проекта</h1>
      <p>Доступ только для получателя ссылки. Данные показаны без возможности редактирования.</p>
      <dl>${rows
        .map(
          ([label, value]) =>
            `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`,
        )
        .join("")}</dl>
    </article>`,
  );
}

function errorResponse(status: number): Response {
  const message =
    status === 404
      ? "Ссылка не найдена."
      : status === 403
        ? "Ссылка недоступна или срок её действия завершён."
        : "Не удалось открыть выпуск. Попробуйте позже.";

  return new Response(
    documentShell(
      "Гостевой доступ — RemHaOS",
      `<article><p>RemHaOS · гостевой доступ</p><h1>${escapeHtml(
        message,
      )}</h1></article>`,
    ),
    { status, headers: privateHeaders },
  );
}

export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ readonly token: string }> },
): Promise<Response> {
  const { token } = await context.params;

  try {
    const projection = await readProjectCeoGuestRelease(token);
    return new Response(releaseDocument(projection), {
      status: 200,
      headers: privateHeaders,
    });
  } catch (error) {
    if (error instanceof ProjectCeoGuestLinkError) {
      if (error.code === "invalid_token" || error.code === "not_found") {
        return errorResponse(404);
      }
      if (
        error.code === "revoked" ||
        error.code === "expired" ||
        error.code === "forbidden"
      ) {
        return errorResponse(403);
      }
    }
    return errorResponse(500);
  }
}
