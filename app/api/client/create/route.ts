import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Governed M1 requires a real human owner for review and approval. Do not create
// an ownerless project until a safe ownership-claim flow exists: otherwise the
// public token can consume metered AI and only fail after the provider returns.
export async function POST() {
  return NextResponse.json(
    {
      code: "self_serve_intake_unavailable",
      error:
        "Самостоятельный бриф временно недоступен. Попросите дизайнера прислать персональную ссылку.",
    },
    {
      status: 503,
      headers: { "Retry-After": "3600" },
    },
  );
}
