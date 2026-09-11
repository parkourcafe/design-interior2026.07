"use client";

import { useEffect, useRef, useState } from "react";
import { ru } from "@/lib/i18n/ru";
import type { ConsentDocument } from "@/lib/legal/consent-policy";

export function ConsentForm({ action, onReady }: { action: "preauth" | "account"; onReady: (enabled: boolean) => void }) {
  const requestId = useRef<string | null>(null);
  const [document, setDocument] = useState<ConsentDocument | null>(null);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    void fetch("/api/auth/consent", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!active) return;
      if (data.enabled === false) { setSaved(true); onReady(false); }
      else if (data.document) setDocument(data.document);
      else throw new Error();
    }).catch(() => { if (active) setError(ru.consent.unavailable); });
    return () => { active = false; };
  }, [onReady]);
  async function accept() {
    if (!checked || !document) return;
    requestId.current ??= crypto.randomUUID();
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/consent", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, accepted: true, documentId: document.id, requestId: requestId.current }),
      });
      if (!response.ok) throw new Error();
      setSaved(true); onReady(true);
    } catch { setError(ru.consent.saveError); }
    finally { setBusy(false); }
  }
  if (saved) return null;
  return <section className="my-4 space-y-3" aria-label={ru.consent.documentTitle}>
    {document ? <>
      <h2 className="font-semibold">{ru.consent.documentTitle}</h2>
      <p className="text-sm">{document.operator}</p>
      <p className="text-sm">{document.version}</p>
      <p className="break-all text-xs">SHA-256: {document.sha256}</p>
      <div className="max-h-64 overflow-auto whitespace-pre-wrap rounded border border-line p-3 text-sm">{document.body}</div>
      <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />{ru.consent.acceptLabel}</label>
      <button type="button" className="btn min-h-11" disabled={!checked || busy} onClick={() => void accept()}>{ru.consent.acceptButton}</button>
    </> : !error && <p>{ru.consent.loading}</p>}
    {error && <div><p role="alert">{error}</p><button type="button" className="btn-ghost min-h-11" onClick={() => window.location.reload()}>{ru.consent.reload}</button></div>}
  </section>;
}
