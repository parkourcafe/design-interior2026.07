"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import AccountWithdrawal from "./AccountWithdrawal";
import { ConsentForm } from "./ConsentForm";
import { accountConsentNext } from "@/lib/legal/account-consent";
import { ru } from "@/lib/i18n/ru";

export default function AccountConsentPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const consentReady = useCallback(() => setReady(true), []);
  const proceed = useCallback(() => {
    router.replace(accountConsentNext(new URLSearchParams(window.location.search).get("next")));
    router.refresh();
  }, [router]);
  return <main className="mx-auto max-w-xl px-6 py-12">
    <h1 className="font-display text-2xl">{ru.consent.documentTitle}</h1>
    <ConsentForm action="account" onReady={consentReady} />
    {ready && <button type="button" className="btn-primary min-h-11" onClick={proceed}>{ru.consent.continueButton}</button>}
    <AccountWithdrawal key={String(ready)} />
  </main>;
}
