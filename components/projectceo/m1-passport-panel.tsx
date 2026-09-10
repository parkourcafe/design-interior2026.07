import { ru } from "@/lib/i18n/ru";
import { Badge } from "./badges";
import type { M1WorkspaceView } from "./contracts";

const copy = ru.projectCeo.workspace.m1.legacyPassport;

function record(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function date(value: string): string {
  return new Intl.DateTimeFormat(ru.projectCeo.common.locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function M1PassportPanel({
  m1,
}: {
  readonly m1: M1WorkspaceView;
}) {
  const passport = m1.contractedPassport;
  const object = record(passport?.passport.object);
  const objectType = text(object.type);
  const city = text(object.city);
  const area = typeof object.area_m2 === "number" && Number.isFinite(object.area_m2)
    ? `${object.area_m2.toLocaleString(ru.projectCeo.common.locale)} м²`
    : null;
  const document = m1.contractDocument;

  return (
    <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{copy.title}</p>
          <h2 className="mt-1 font-display text-2xl font-semibold">{copy.title}</h2>
          <p className="mt-2 text-sm leading-6 text-muted">{copy.lead}</p>
        </div>
        {passport && <Badge tone={passport.llmOk ? "success" : "warning"}>{copy.revision(passport.revisionNo)}</Badge>}
      </div>

      {passport ? (
        <div className="mt-4 space-y-3 rounded-xl bg-paper p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span>{copy.generatedAt(date(passport.createdAt))}</span>
            <span>{passport.llmOk ? copy.llmVerified : copy.llmUnverified}</span>
          </div>
          {(objectType || area || city) && (
            <dl className="grid gap-2 text-sm sm:grid-cols-3">
              {objectType && <div><dt className="text-xs text-muted">{copy.objectType}</dt><dd className="mt-1 font-medium">{objectType}</dd></div>}
              {area && <div><dt className="text-xs text-muted">{copy.area}</dt><dd className="mt-1 font-medium">{area}</dd></div>}
              {city && <div><dt className="text-xs text-muted">{copy.city}</dt><dd className="mt-1 font-medium">{city}</dd></div>}
            </dl>
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">{copy.emptyPassport}</p>
      )}

      <div className="mt-4 border-t border-line pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">{copy.contractTitle}</p>
          {document && <Badge tone={document.status === "signed" ? "success" : "neutral"}>{copy.status[document.status]}</Badge>}
        </div>
        {document ? (
          <div className="mt-2 space-y-1 text-xs text-muted">
            <p>{copy.documentStatus}: {copy.status[document.status]}</p>
            <p>{copy.documentCreatedAt(date(document.createdAt))}</p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">{copy.noContract}</p>
        )}
      </div>

      {m1.stateRevision != null && (
        <p className="mt-4 text-xs text-muted">{copy.stateRevision(m1.stateRevision)}</p>
      )}
    </section>
  );
}
