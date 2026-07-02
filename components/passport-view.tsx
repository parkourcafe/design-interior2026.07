import type { Passport, MoneyRange } from "@/lib/types";
import { ru } from "@/lib/i18n/ru";

const pv = ru.passportView;

function money(range: MoneyRange | "undisclosed"): string {
  if (range === "undisclosed") return pv.undisclosed;
  return `${range[0].toLocaleString("ru-RU")}–${range[1].toLocaleString("ru-RU")} ₽`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-line py-2 last:border-0 sm:flex-row sm:gap-4">
      <div className="w-40 shrink-0 text-sm text-muted">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

export default function PassportView({ passport }: { passport: Passport }) {
  const o = passport.object;
  return (
    <div className="card">
      <Row label={pv.object}>
        {o.type ? pv.packageValue[o.type] ?? o.type : pv.notFilled}
        {o.area_m2 ? `, ${o.area_m2} м²` : ""}
        {o.city ? `, ${o.city}` : ""}
      </Row>
      <Row label={pv.assetHorizon}>{pv.assetHorizonValue[passport.asset_horizon]}</Row>
      <Row label={pv.household}>
        {pv.now}: {passport.household.now}; {pv.in5y}: {passport.household.in_5y}
        {passport.household.kids ? ` · ${pv.kids}` : ""}
        {passport.household.pets ? ` · ${pv.pets}` : ""}
      </Row>
      <Row label={pv.lifestyle}>
        {pv.morningLoad}: {pv.loadValue[passport.lifestyle.morning_load]}
        {passport.lifestyle.bathrooms ? ` · ${pv.bathrooms}: ${passport.lifestyle.bathrooms}` : ""}
        {" · "}
        {pv.cooking}: {pv.cookingValue[passport.lifestyle.cooking]}
        {" · "}
        {pv.storage}: {pv.loadValue[passport.lifestyle.storage_pressure]}
      </Row>
      <Row label={pv.budget}>{money(passport.budget.range)}</Row>
      <Row label={pv.timeline}>
        {passport.timeline.target} · {pv.urgencyValue[passport.timeline.urgency]}
      </Row>
      <Row label={pv.style}>
        {passport.style.refs.length > 0 && (
          <div>
            {pv.refs}:{" "}
            {passport.style.refs.map((r, i) => (
              <span key={i} className="break-all text-accent">
                {r}
                {i < passport.style.refs.length - 1 ? ", " : ""}
              </span>
            ))}
          </div>
        )}
        {passport.style.anti.length > 0 && (
          <div>
            {pv.anti}: {passport.style.anti.join(", ")}
          </div>
        )}
        {passport.style.notes && <div>{passport.style.notes}</div>}
        {passport.style.refs.length === 0 &&
          passport.style.anti.length === 0 &&
          !passport.style.notes &&
          pv.notFilled}
      </Row>
      <Row label={pv.pain}>{passport.pain_points || pv.notFilled}</Row>
    </div>
  );
}
