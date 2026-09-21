import { legalOperator } from "@/lib/env";
import { ru } from "@/lib/i18n/ru";

const l = ru.landing.legal;

export default function OperatorDetails() {
  const operator = legalOperator();
  const email = operator.email.endsWith(".invalid") ? null : operator.email;
  const phone = /^[+\d][\d\s()+-]+$/.test(operator.phone) ? operator.phone : null;
  const details = [
    [l.innLabel, operator.inn],
    [l.ogrnipLabel, operator.ogrnip],
    [l.registrationDateLabel, operator.registrationDate],
    [l.registrationAuthorityLabel, operator.registrationAuthority],
  ];

  return (
    <section className="mt-10 border-t border-linedark pt-8">
      <h2 className="mb-2 text-xl font-semibold">{l.operatorTitle}</h2>
      <div className="space-y-2 break-words leading-relaxed">
        <p>{operator.name}</p>
        {operator.address && operator.address !== "Адрес не указан" ? <p>{operator.address}</p> : null}
        <dl>
          {details.filter(([, value]) => value).map(([label, value]) => (
            <div key={label} className="mt-2">
              <dt className="font-semibold">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {email ? <a className="flex min-h-11 items-center underline" href={`mailto:${email}`}>{email}</a> : null}
        {phone ? <a className="flex min-h-11 items-center underline" href={`tel:${phone.replace(/[\s()-]/g, "")}`}>{phone}</a> : null}
      </div>
    </section>
  );
}
