import { z } from "zod";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { acceptanceSchema, consentEnabled } from "@/lib/legal/consent-policy";
import { ensureBrowserConsentProof, readConsentDocument, recordBrowserConsent, sameOrigin, readBrowserConsentReceipt, withdrawBrowserConsent } from "@/lib/legal/consent-server";

export const dynamic = "force-dynamic";
const accountReceiptSchema = z.object({ receiptId: z.string().uuid(), acceptedAt: z.string().datetime({ offset: true }), expiresAt: z.string().datetime({ offset: true }).nullable() });
const headers = { "Cache-Control": "no-store" };

export async function GET(request?: Request) {
  if (request && new URL(request.url).searchParams.get("browserReceipt") === "1") {
    try {
      const client = await createClient();
      const receipt = await readBrowserConsentReceipt(client, "account", "");
      return NextResponse.json({ receipt }, { headers });
    } catch { return NextResponse.json({ error: "consent_unavailable" }, { status: 503, headers }); }
  }
  if (request && new URL(request.url).searchParams.get("receipt") === "1") {
    try {
      const client = await createClient();
      const { data: { user }, error: authError } = await client.auth.getUser();
      if (authError || !user) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers });
      const { data, error } = await client.rpc("get_my_consent_receipt");
      if (error) throw new Error("consent_unavailable");
      return NextResponse.json({ receipt: data }, { headers });
    } catch { return NextResponse.json({ error: "consent_unavailable" }, { status: 503, headers }); }
  }
  if (!consentEnabled()) return NextResponse.json({ enabled: false }, { headers });
  try {
    const client = await createClient();
    const document = await readConsentDocument(client, "account");
    if (!document) return NextResponse.json({ error: "consent_unavailable" }, { status: 503, headers });
    await ensureBrowserConsentProof("account");
    return NextResponse.json({ enabled: true, document }, { headers });
  } catch {
    return NextResponse.json({ error: "consent_unavailable" }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403, headers });
  if (!consentEnabled()) return NextResponse.json({ enabled: false }, { headers });
  const body = await request.json().catch(() => null);
  const parsed = acceptanceSchema.safeParse(body);
  if (!parsed.success || !["preauth", "account"].includes(body?.action)) {
    return NextResponse.json({ error: "consent_required" }, { status: 400, headers });
  }
  try {
    const client = await createClient();
    const document = await readConsentDocument(client, "account");
    if (!document) return NextResponse.json({ error: "consent_unavailable" }, { status: 503, headers });
    if (document.id !== parsed.data.documentId) return NextResponse.json({ error: "consent_stale" }, { status: 409, headers });
    if (body.action === "preauth") {
      await recordBrowserConsent(client, "account", "", parsed.data);
    } else {
      const { data: { user }, error: authError } = await client.auth.getUser();
      if (authError || !user) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers });
      const { data, error } = await client.rpc("accept_my_consent", {
        p_document_id: parsed.data.documentId,
        p_accepted: true,
        p_request_id: parsed.data.requestId,
      });
      const receipt = accountReceiptSchema.safeParse(data);
      if (error || !receipt.success) throw new Error("consent_failed");
      return NextResponse.json({ ok: true, receipt: receipt.data }, { headers });
    }
    return NextResponse.json({ ok: true }, { headers });
  } catch {
    return NextResponse.json({ error: "consent_unavailable" }, { status: 503, headers });
  }
}

// Withdrawal remains available after a document expires or enforcement stops.
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403, headers });
  const body = await request.json().catch(() => null);
  const parsed = acceptanceSchema.shape.documentId.safeParse(body?.receiptId);
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400, headers });
  try {
    const client = await createClient();
    if (body.action === "preauth") {
      await withdrawBrowserConsent(client, "account", "", parsed.data);
      return NextResponse.json({ ok: true }, { headers });
    }
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers });
    const { error } = await client.rpc("withdraw_my_consent", { p_receipt_id: parsed.data });
    if (error) throw new Error("withdrawal_failed");
    return NextResponse.json({ ok: true }, { headers });
  } catch {
    return NextResponse.json({ error: "consent_unavailable" }, { status: 503, headers });
  }
}
