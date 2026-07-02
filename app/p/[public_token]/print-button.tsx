"use client";

import { ru } from "@/lib/i18n/ru";

export default function PrintButton() {
  return (
    <button onClick={() => window.print()} className="btn-ghost no-print">
      {ru.proposal.print}
    </button>
  );
}
