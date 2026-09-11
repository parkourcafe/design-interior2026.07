"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ru } from "@/lib/i18n/ru";
import type { ConsentDocument } from "@/lib/legal/consent-policy";

export default function IntakeConsentGate({ token, children }: { token: string; children: (enabled: boolean) => ReactNode }) {
  const [ready, setReady] = useState<boolean | null>(null);
  const [document, setDocument] = useState<ConsentDocument | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef<string | null>(null);
  async function call(input: Record<string, unknown>) {
    const response = await fetch("/api/intake/consent", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", "X-Intake-Token": token }, body: JSON.stringify({ token, ...input }) });
    if (!response.ok) throw new Error();
    return response.json();
  }
  useEffect(() => {
    let active = true;
    void fetch("/api/intake/consent", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", "X-Intake-Token": token }, body: JSON.stringify({ action: "status", token }) }).then(async (response) => {
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!active) return;
      if (data.enabled === false) { setReady(false); return; }
      setReceiptId(data.receipt?.receiptId ?? null);
      if (!data.document) { setError(ru.consent.unavailable); return; }
      setDocument(data.document);
      if (data.accepted === true) setReady(true);
    }).catch(() => { if (active) setError(ru.consent.unavailable); });
    return () => { active = false; };
  }, [token]);
  async function accept() {
    if (!document || !checked) return;
    requestId.current ??= crypto.randomUUID();
    setBusy(true); setError("");
    try {
      const data = await call({ action: "accept", accepted: true, documentId: document.id, requestId: requestId.current });
      if (!data.receipt?.receiptId) throw new Error();
      setReceiptId(data.receipt.receiptId); setReady(true);
    } catch { setError(ru.consent.saveError); }
    finally { setBusy(false); }
  }
  async function withdraw() {
    if (!receiptId) return;
    setBusy(true); setError("");
    try {
      await call({ action: "withdraw", receiptId });
      setReady(null); setReceiptId(null); setChecked(false); requestId.current = null;
      setError(ru.consent.withdrawn);
    } catch { setError(ru.consent.saveError); }
    finally { setBusy(false); }
  }
  return <>
    <div className="mx-auto max-w-xl px-6"><Link className="inline-flex min-h-11 items-center underline" href={`/i/${encodeURIComponent(token)}/consent`}>{ru.consent.manage}</Link></div>
    {ready !== null ? <>
      {ready && receiptId && <div className="mx-auto max-w-xl px-6 py-3"><button type="button" className="btn-ghost min-h-11" disabled={busy} onClick={() => void withdraw()}>{ru.consent.withdrawButton}</button>{error && <div><p role="alert">{error}</p><button type="button" className="btn-ghost min-h-11" onClick={() => window.location.reload()}>{ru.consent.reload}</button></div>}</div>}
      {children(ready)}
    </> : <main className="mx-auto max-w-xl space-y-4 px-6 py-12">
      <h1 className="font-display text-2xl">{ru.consent.documentTitle}</h1>
      {receiptId && <button type="button" className="btn-ghost min-h-11" disabled={busy} onClick={() => void withdraw()}>{ru.consent.withdrawButton}</button>}
      {document ? <>
        <p>{document.operator}</p><p>{document.version}</p>
        <p className="break-all text-xs">SHA-256: {document.sha256}</p>
        <div className="max-h-80 overflow-auto whitespace-pre-wrap rounded border border-line p-4">{document.body}</div>
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />{ru.consent.acceptLabel}</label>
        <button type="button" className="btn-primary min-h-11" disabled={!checked || busy} onClick={() => void accept()}>{ru.consent.acceptButton}</button>
      </> : !error && <p>{ru.consent.loading}</p>}
      {error && <div><p role="alert">{error}</p><button type="button" className="btn-ghost min-h-11" onClick={() => window.location.reload()}>{ru.consent.reload}</button></div>}
    </main>}
  </>;
}
