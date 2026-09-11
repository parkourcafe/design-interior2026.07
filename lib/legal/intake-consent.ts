import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { consentEnabled } from "./consent-policy";
import { hasBrowserConsent, sameOrigin } from "./consent-server";

// Check the independently readable header before parsing answers or file bytes.
export async function enforceIntakeConsent(request: Request) {
  if (!consentEnabled()) return null;
  if (!sameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const token = request.headers.get("x-intake-token");
  if (!token || token.length > 1024) return NextResponse.json({ error: "consent_required" }, { status: 403 });
  try {
    if (!(await hasBrowserConsent(await createClient(), "intake", token))) {
      return NextResponse.json({ error: "consent_required" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "consent_unavailable" }, { status: 503 });
  }
  return null;
}

export function intakeTokenMatches(request: Request, token: unknown): boolean {
  return !consentEnabled() || (typeof token === "string" && request.headers.get("x-intake-token") === token);
}
