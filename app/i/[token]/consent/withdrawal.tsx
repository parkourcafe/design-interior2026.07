"use client";
import { useEffect, useState } from "react";
import { ru } from "@/lib/i18n/ru";
export default function IntakeWithdrawal({ token }: { token: string }) {
  const [receipt, setReceipt] = useState<string | null>(null);
  const [message, setMessage] = useState<string>(ru.consent.loading);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void fetch("/api/intake/consent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "receipt", token }) }).then(async response => {
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (active) { setReceipt(data.receipt?.receiptId ?? null); setMessage(data.receipt ? "" : ru.consent.noReceipt); }
    }).catch(() => { if (active) setMessage(ru.consent.unavailable); });
    return () => { active = false; };
  }, [token]);
  async function withdraw() {
    setBusy(true);
    try {
      const response = await fetch("/api/intake/consent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "withdraw", token, receiptId: receipt }) });
      if (!response.ok) throw new Error();
      setReceipt(null); setMessage(ru.consent.withdrawn);
    } catch { setMessage(ru.consent.saveError); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-xl space-y-4 px-6 py-12">
    <h1 className="font-display text-2xl">{ru.consent.manage}</h1>
    <p>{ru.consent.sameBrowser}</p>
    {receipt && <button type="button" className="btn-primary min-h-11" disabled={busy} onClick={() => void withdraw()}>{ru.consent.withdrawButton}</button>}
    {message && <p role="status">{message}</p>}
  </main>;
}
