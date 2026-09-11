"use client";

import { useEffect, useState } from "react";
import { ru } from "@/lib/i18n/ru";

export default function AccountWithdrawal({ preauth = false, onWithdraw }: { preauth?: boolean; onWithdraw?: () => void }) {
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [message, setMessage] = useState(ru.consent.loading as string);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void fetch(preauth ? "/api/auth/consent?browserReceipt=1" : "/api/auth/consent?receipt=1", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!active) return;
      setReceiptId(data.receipt?.receiptId ?? null);
      setMessage(data.receipt ? "" : ru.consent.noReceipt);
    }).catch(() => { if (active) setMessage(ru.consent.unavailable); });
    return () => { active = false; };
  }, [preauth]);
  async function withdraw() {
    setBusy(true);
    try {
      const response = await fetch("/api/auth/consent", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ receiptId, action: preauth ? "preauth" : "account" }) });
      if (!response.ok) throw new Error();
      setReceiptId(null); setMessage(ru.consent.withdrawn); onWithdraw?.();
    } catch { setMessage(ru.consent.saveError); }
    finally { setBusy(false); }
  }
  return <section className="my-6 space-y-3">
    <h2 className="font-semibold">{ru.consent.manage}</h2>
    {receiptId && <button type="button" className="btn-ghost min-h-11" disabled={busy} onClick={() => void withdraw()}>{ru.consent.withdrawButton}</button>}
    {message && <p role="status">{message}</p>}
  </section>;
}
