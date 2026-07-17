"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ru } from "@/lib/i18n/ru";
import { setPackage } from "./actions";
import type { ScopePackage } from "@/lib/types";
import type { ComplexityLevel } from "@/lib/pricing/calc";

type Pkg = Exclude<ScopePackage, null>;
const PACKAGES: Pkg[] = ["concept", "full", "full_plus_supervision"];

// Параметры предложения: дизайнер выбирает пакет услуг (влияет на состав/сроки/
// цену), сложность выводится из паспорта автоматически и показывается справочно.
export default function PricingControls({
  projectId,
  currentPackage,
  complexity,
  hasPricing,
}: {
  projectId: string;
  currentPackage: Pkg;
  complexity: ComplexityLevel;
  hasPricing: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pkg, setPkg] = useState<Pkg>(currentPackage);
  const c = ru.proposal.pricingControls;

  function change(next: Pkg) {
    setPkg(next);
    start(async () => {
      await setPackage(projectId, next);
      router.refresh();
    });
  }

  return (
    <section className="card mb-6">
      <h2 className="font-display text-lg font-semibold">{c.title}</h2>
      <p className="mt-1 text-sm text-muted">{c.hint}</p>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-1 text-sm">
          <span className="mb-1 block text-muted">{c.packageLabel}</span>
          <select
            className="input"
            value={pkg}
            disabled={pending}
            onChange={(e) => change(e.target.value as Pkg)}
          >
            {PACKAGES.map((p) => (
              <option key={p} value={p}>
                {c.packages[p]}
              </option>
            ))}
          </select>
        </label>
        {hasPricing && (
          <div className="text-sm text-muted sm:pb-2">
            {c.complexityLabel}:{" "}
            <span className="font-medium text-ink">{c.complexity[complexity]}</span>{" "}
            <span className="text-xs">{c.complexityAuto}</span>
          </div>
        )}
      </div>
      {pending && <p className="mt-2 text-xs text-muted">{c.saving}</p>}
    </section>
  );
}
