"use client";

import { useState, useTransition } from "react";
import type { PricingConfig, ProposalDefaults } from "@/lib/types";
import { saveSetup, type SetupPayload } from "./actions";
import { ru } from "@/lib/i18n/ru";

const DEFAULT_PRICING: PricingConfig = {
  base_rate_per_m2: 3500,
  multipliers: {
    complexity: { low: 0.85, mid: 1.0, high: 1.4 },
    urgency: 1.3,
    package: { concept: 0.6, full: 1.0, full_plus_supervision: 1.35 },
  },
};

export default function SetupForm({ initial }: { initial: SetupPayload }) {
  const [name, setName] = useState(initial.name);
  const [studio, setStudio] = useState(initial.studio_name);
  const [priceEnabled, setPriceEnabled] = useState(initial.pricing !== null);
  const [pricing, setPricing] = useState<PricingConfig>(initial.pricing ?? DEFAULT_PRICING);
  const [defaults, setDefaults] = useState<ProposalDefaults>(initial.proposal_defaults);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function save() {
    startTransition(async () => {
      const res = await saveSetup({
        name,
        studio_name: studio,
        pricing: priceEnabled ? pricing : null,
        proposal_defaults: defaults,
      });
      setSaved(res.ok);
    });
  }

  function setMul(path: string, value: number) {
    setPricing((p) => {
      const next = structuredClone(p);
      if (path === "base") next.base_rate_per_m2 = value;
      else if (path === "urgency") next.multipliers.urgency = value;
      else if (path.startsWith("complexity.")) {
        const k = path.split(".")[1] as "low" | "mid" | "high";
        next.multipliers.complexity[k] = value;
      } else if (path.startsWith("package.")) {
        const k = path.split(".")[1] as "concept" | "full" | "full_plus_supervision";
        next.multipliers.package[k] = value;
      }
      return next;
    });
    setSaved(false);
  }

  return (
    <div className="max-w-2xl space-y-8">
      <h1 className="text-2xl font-semibold">{ru.nav.setup}</h1>

      <section className="card space-y-4">
        <h2 className="font-semibold">Профиль</h2>
        <div>
          <label className="label">Имя</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Студия</label>
          <input className="input" value={studio} onChange={(e) => setStudio(e.target.value)} />
        </div>
      </section>

      <section className="card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Ценообразование</h2>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={priceEnabled}
              onChange={(e) => {
                setPriceEnabled(e.target.checked);
                setSaved(false);
              }}
            />
            Считать цену
          </label>
        </div>

        {priceEnabled ? (
          <div className="space-y-4">
            <NumberField
              label="Базовая ставка, ₽/м²"
              value={pricing.base_rate_per_m2}
              step={100}
              onChange={(v) => setMul("base", v)}
            />
            <div className="grid grid-cols-3 gap-3">
              <NumberField label="Сложность: низкая ×" value={pricing.multipliers.complexity.low} step={0.05} onChange={(v) => setMul("complexity.low", v)} />
              <NumberField label="средняя ×" value={pricing.multipliers.complexity.mid} step={0.05} onChange={(v) => setMul("complexity.mid", v)} />
              <NumberField label="высокая ×" value={pricing.multipliers.complexity.high} step={0.05} onChange={(v) => setMul("complexity.high", v)} />
            </div>
            <NumberField label="Срочность ×" value={pricing.multipliers.urgency} step={0.05} onChange={(v) => setMul("urgency", v)} />
            <div className="grid grid-cols-3 gap-3">
              <NumberField label="Пакет: концепция ×" value={pricing.multipliers.package.concept} step={0.05} onChange={(v) => setMul("package.concept", v)} />
              <NumberField label="полный ×" value={pricing.multipliers.package.full} step={0.05} onChange={(v) => setMul("package.full", v)} />
              <NumberField label="+надзор ×" value={pricing.multipliers.package.full_plus_supervision} step={0.05} onChange={(v) => setMul("package.full_plus_supervision", v)} />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">{ru.proposal.noPrice}</p>
        )}
      </section>

      <section className="card space-y-4">
        <h2 className="font-semibold">Шаблон КП</h2>
        <div>
          <label className="label">Что не входит (по строке)</label>
          <textarea
            className="input min-h-24"
            value={defaults.exclusions.join("\n")}
            onChange={(e) => {
              setDefaults({
                ...defaults,
                exclusions: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean),
              });
              setSaved(false);
            }}
          />
        </div>
        <NumberField
          label="Лимит правок на этап"
          value={defaults.revision_limit}
          step={1}
          onChange={(v) => {
            setDefaults({ ...defaults, revision_limit: v });
            setSaved(false);
          }}
        />
        <div>
          <label className="label">Условие завершения этапа</label>
          <textarea
            className="input min-h-20"
            value={defaults.stage_completion}
            onChange={(e) => {
              setDefaults({ ...defaults, stage_completion: e.target.value });
              setSaved(false);
            }}
          />
        </div>
      </section>

      <button onClick={save} disabled={pending} className="btn-primary">
        {pending ? ru.proposal.saving : saved ? ru.proposal.saved : ru.proposal.save}
      </button>
    </div>
  );
}

function NumberField({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        type="number"
        step={step}
        className="input"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
