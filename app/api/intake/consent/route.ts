import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { acceptanceSchema, consentEnabled } from "@/lib/legal/consent-policy";
import { ensureBrowserConsentProof, hasBrowserConsent, readBrowserConsentReceipt, readConsentDocument, recordBrowserConsent, sameOrigin, withdrawBrowserConsent } from "@/lib/legal/consent-server";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
const scope = z.object({ token: z.string().min(1).max(1024) });
const inputSchema = z.discriminatedUnion("action", [
  scope.extend({ action: z.literal("status") }),
  scope.extend({ action: z.literal("receipt") }),
  scope.merge(acceptanceSchema).extend({ action: z.literal("accept") }),
  scope.extend({ action: z.literal("withdraw"), receiptId: z.string().uuid() }),
]);

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "invalid_consent" }, { status: 400 });
  if (!consentEnabled() && !["withdraw", "receipt"].includes(input.data.action)) return NextResponse.json({ enabled: false });
  if (!(await checkRateLimit("intake_consent", clientIp(request), 60, 60_000))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  try {
    const client = await createClient();
    const body = input.data;
    if (body.action === "withdraw") {
      await withdrawBrowserConsent(client, "intake", body.token, body.receiptId);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "receipt") return NextResponse.json({ receipt: await readBrowserConsentReceipt(client, "intake", body.token) });
    const document = await readConsentDocument(client, "intake");
    if (body.action === "status") {
      await ensureBrowserConsentProof("intake", body.token);
      return NextResponse.json({ enabled: true, document, accepted: document ? await hasBrowserConsent(client, "intake", body.token) : false, receipt: await readBrowserConsentReceipt(client, "intake", body.token) });
    }
    if (!document) return NextResponse.json({ error: "consent_unavailable" }, { status: 503 });
    if (body.documentId !== document.id) return NextResponse.json({ error: "consent_changed" }, { status: 409 });
    const receipt = await recordBrowserConsent(client, "intake", body.token, body);
    return NextResponse.json({ enabled: true, receipt });
  } catch {
    return NextResponse.json({ error: "consent_unavailable" }, { status: 503 });
  }
}
