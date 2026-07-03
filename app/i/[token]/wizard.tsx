"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { visibleQuestions, type Question } from "@/lib/brief/questions";
import { appUrl } from "@/lib/env";
import { ru } from "@/lib/i18n/ru";
import ShareBrief from "@/components/share-brief";

type Answers = Record<string, unknown>;

const BUDGET_BRACKETS: { value: string; label: string; range: [number, number] }[] = [
  { value: "economy", label: "до 1,5 млн ₽", range: [500_000, 1_500_000] },
  { value: "middle", label: "1,5–3,5 млн ₽", range: [1_500_000, 3_500_000] },
  { value: "upper", label: "3,5–6 млн ₽", range: [3_500_000, 6_000_000] },
  { value: "premium", label: "от 6 млн ₽", range: [6_000_000, 12_000_000] },
];

export default function IntakeWizard({
  token,
  selfServe = false,
}: {
  token: string;
  selfServe?: boolean;
}) {
  const [started, setStarted] = useState(false);
  const [answers, setAnswers] = useState<Answers>({});
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  // Свободные комментарии к каждому вопросу (в т.ч. надиктованные голосом).
  const [comments, setComments] = useState<Record<string, string>>({});

  const visible = useMemo(() => visibleQuestions(answers), [answers]);
  const question = visible[step];

  useEffect(() => {
    if (started) {
      fetch("/api/intake/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      }).catch(() => {});
    }
  }, [started, token]);

  function setAnswer(id: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  function canProceed(q: Question): boolean {
    if (q.optional) return true;
    const v = answers[q.id];
    switch (q.type) {
      case "object": {
        const o = (v ?? {}) as { type?: string; area_m2?: number; city?: string };
        return Boolean(o.type && o.area_m2 && o.city);
      }
      case "budget":
        return Boolean(v && typeof v === "object" && "range" in (v as object));
      case "multi":
        return Array.isArray(v) && v.length > 0;
      case "number":
        return typeof v === "number" && !Number.isNaN(v);
      case "style":
      case "text":
        return true; // не блокируем — конверсия важнее
      default:
        return v !== undefined && v !== "";
    }
  }

  async function finish() {
    setSubmitting(true);
    const res = await fetch("/api/intake/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, answers: { ...answers, comments } }),
    });
    setSubmitting(false);
    if (res.ok) setDone(true);
  }

  function next() {
    if (step < visible.length - 1) setStep(step + 1);
    else finish();
  }

  if (done) {
    if (selfServe) {
      return (
        <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 text-center">
          <h1 className="text-2xl font-semibold">{ru.client.shareTitle}</h1>
          <p className="mt-2 text-muted">{ru.client.shareHint}</p>
          <ShareBrief url={`${appUrl()}/b/${token}`} />
        </main>
      );
    }
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 text-center">
        <h1 className="text-2xl font-semibold">{ru.brief.done.title}</h1>
        <p className="mt-2 text-muted">{ru.brief.done.subtitle}</p>
      </main>
    );
  }

  if (!started) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
        <h1 className="text-3xl font-semibold">{ru.brief.intro.title}</h1>
        <p className="mt-3 text-muted">{ru.brief.intro.subtitle}</p>
        <button onClick={() => setStarted(true)} className="btn-primary mt-8 w-fit">
          {ru.brief.intro.start}
        </button>
      </main>
    );
  }

  if (!question) return null;

  const total = visible.length;
  const progress = Math.round(((step + 1) / total) * 100);

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col px-6 py-10">
      <div className="mb-6 h-1 w-full rounded bg-line">
        <div className="h-1 rounded bg-accent transition-all" style={{ width: `${progress}%` }} />
      </div>
      <p className="text-xs uppercase tracking-widest text-muted">
        {step + 1} / {total}
      </p>
      <h2 className="mt-2 text-2xl font-semibold">{question.title}</h2>
      {question.help && <p className="mt-2 text-sm text-muted">{question.help}</p>}
      {question.optional && <p className="mt-1 text-xs text-muted">({ru.brief.optional})</p>}

      <div className="mt-6 flex-1">
        <QuestionInput
          question={question}
          value={answers[question.id]}
          onChange={(v) => setAnswer(question.id, v)}
          token={token}
        />

        {question.type !== "files" && (
          <CommentField
            value={comments[question.id] ?? ""}
            onChange={(v) => setComments((prev) => ({ ...prev, [question.id]: v }))}
          />
        )}
      </div>

      <div className="mt-8 flex items-center justify-between">
        <button
          onClick={() => setStep(Math.max(0, step - 1))}
          disabled={step === 0}
          className="btn-ghost"
        >
          {ru.brief.back}
        </button>
        <button onClick={next} disabled={!canProceed(question) || submitting} className="btn-primary">
          {submitting
            ? ru.brief.saving
            : step === total - 1
              ? ru.brief.finish
              : ru.brief.next}
        </button>
      </div>
    </main>
  );
}

function QuestionInput({
  question,
  value,
  onChange,
  token,
}: {
  question: Question;
  value: unknown;
  onChange: (v: unknown) => void;
  token: string;
}) {
  switch (question.type) {
    case "object":
      return <ObjectInput value={value} onChange={onChange} />;
    case "choice":
      return <ChoiceInput question={question} value={value} onChange={onChange} />;
    case "multi":
      return <MultiInput question={question} value={value} onChange={onChange} />;
    case "number":
      return (
        <input
          type="number"
          className="input"
          value={typeof value === "number" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
      );
    case "text":
      return (
        <textarea
          className="input min-h-28"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "budget":
      return <BudgetInput value={value} onChange={onChange} />;
    case "style":
      return <StyleInput value={value} onChange={onChange} />;
    case "files":
      return <FilesInput token={token} />;
    default:
      return null;
  }
}

function ObjectInput({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const o = (value ?? {}) as {
    type?: string;
    area_m2?: number;
    city?: string;
    district?: string;
    floor?: number;
    building?: string;
  };
  const types = [
    { value: "flat", label: "Квартира" },
    { value: "house", label: "Дом" },
    { value: "apartments", label: "Апартаменты" },
  ];
  const buildings = [
    { value: "new", label: "Новостройка" },
    { value: "secondary", label: "Вторичка" },
    { value: "private", label: "Частный дом" },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {types.map((t) => (
          <button
            key={t.value}
            onClick={() => onChange({ ...o, type: t.value })}
            className={`btn-ghost ${o.type === t.value ? "border-accent bg-accent/10" : ""}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div>
        <label className="label">Площадь, м²</label>
        <input
          type="number"
          className="input"
          value={o.area_m2 ?? ""}
          onChange={(e) =>
            onChange({ ...o, area_m2: e.target.value === "" ? undefined : Number(e.target.value) })
          }
        />
      </div>
      <div>
        <label className="label">Город</label>
        <input
          className="input"
          value={o.city ?? ""}
          onChange={(e) => onChange({ ...o, city: e.target.value })}
        />
      </div>
      <div>
        <label className="label">Район <span className="text-muted">(необязательно)</span></label>
        <input
          className="input"
          value={o.district ?? ""}
          onChange={(e) => onChange({ ...o, district: e.target.value })}
        />
      </div>
      <div>
        <label className="label">Этаж <span className="text-muted">(необязательно)</span></label>
        <input
          type="number"
          className="input"
          value={o.floor ?? ""}
          onChange={(e) =>
            onChange({ ...o, floor: e.target.value === "" ? undefined : Number(e.target.value) })
          }
        />
      </div>
      <div>
        <label className="label">Тип дома <span className="text-muted">(необязательно)</span></label>
        <div className="flex flex-wrap gap-2">
          {buildings.map((b) => (
            <button
              key={b.value}
              onClick={() => onChange({ ...o, building: b.value })}
              className={`btn-ghost ${o.building === b.value ? "border-accent bg-accent/10" : ""}`}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ChoiceInput({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  return (
    <div className="space-y-2">
      {question.options?.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`block w-full rounded-md border px-4 py-3 text-left text-sm transition-colors ${
            value === opt.value ? "border-accent bg-accent/10" : "border-line bg-white hover:bg-line/40"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function MultiInput({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const selected = Array.isArray(value) ? (value as string[]) : [];
  function toggle(v: string) {
    onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]);
  }
  return (
    <div className="space-y-2">
      {question.options?.map((opt) => (
        <button
          key={opt.value}
          onClick={() => toggle(opt.value)}
          className={`block w-full rounded-md border px-4 py-3 text-left text-sm transition-colors ${
            selected.includes(opt.value)
              ? "border-accent bg-accent/10"
              : "border-line bg-white hover:bg-line/40"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function BudgetInput({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const current = (value ?? {}) as { range?: [number, number] | "undisclosed" };
  const isUndisclosed = current.range === "undisclosed";
  return (
    <div className="space-y-2">
      {BUDGET_BRACKETS.map((b) => {
        const active =
          Array.isArray(current.range) &&
          current.range[0] === b.range[0] &&
          current.range[1] === b.range[1];
        return (
          <button
            key={b.value}
            onClick={() => onChange({ range: b.range })}
            className={`block w-full rounded-md border px-4 py-3 text-left text-sm transition-colors ${
              active ? "border-accent bg-accent/10" : "border-line bg-white hover:bg-line/40"
            }`}
          >
            {b.label}
          </button>
        );
      })}
      <button
        onClick={() => onChange({ range: "undisclosed" })}
        className={`block w-full rounded-md border px-4 py-3 text-left text-sm transition-colors ${
          isUndisclosed ? "border-accent bg-accent/10" : "border-line bg-white hover:bg-line/40"
        }`}
      >
        Пока не готов назвать
      </button>
    </div>
  );
}

function StyleInput({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const s = (value ?? { refs: [], anti: [], notes: "" }) as {
    refs: string[];
    anti: string[];
    notes: string;
  };
  const refs = s.refs ?? [];

  function updateRef(i: number, v: string) {
    const next = [...refs];
    next[i] = v;
    onChange({ ...s, refs: next });
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="label">Референсы (ссылки)</label>
        {[0, 1, 2].map((i) => (
          <input
            key={i}
            className="input mb-2"
            placeholder="https://…"
            value={refs[i] ?? ""}
            onChange={(e) => updateRef(i, e.target.value)}
          />
        ))}
      </div>
      <div>
        <label className="label">{ru.brief.antiLabel}</label>
        <textarea
          className="input min-h-20"
          placeholder="Например: глянец, холодный белый свет, вычурная классика"
          value={(s.anti ?? []).join("\n")}
          onChange={(e) =>
            onChange({ ...s, anti: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })
          }
        />
      </div>
      <div>
        <label className="label">Заметки о стиле</label>
        <textarea
          className="input min-h-20"
          value={s.notes ?? ""}
          onChange={(e) => onChange({ ...s, notes: e.target.value })}
        />
      </div>
    </div>
  );
}

function FilesInput({ token }: { token: string }) {
  const [uploaded, setUploaded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setBusy(true);
    for (const file of files) {
      const form = new FormData();
      form.append("token", token);
      form.append("file", file);
      const res = await fetch("/api/intake/upload", { method: "POST", body: form });
      if (res.ok) setUploaded((prev) => [...prev, file.name]);
    }
    setBusy(false);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{ru.brief.uploadHint}</p>
      <input type="file" multiple onChange={onFile} disabled={busy} accept="image/*,.pdf" />
      {busy && <p className="text-sm text-muted">{ru.brief.saving}</p>}
      <ul className="text-sm text-muted">
        {uploaded.map((n) => (
          <li key={n}>✓ {n}</li>
        ))}
      </ul>
    </div>
  );
}

// Минимальный тип браузерного распознавания речи (нет в стандартном lib.dom).
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Необязательный комментарий к вопросу + надиктовка голосом (Web Speech API,
// работает в браузере локально; где не поддерживается — просто текстовое поле).
function CommentField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setSupported(getSpeechRecognition() !== null);
  }, []);

  function toggle() {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const SR = getSpeechRecognition();
    if (!SR) return;
    const rec = new SR();
    rec.lang = "ru-RU";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) {
        const alt = e.results[i]?.[0]?.transcript;
        if (alt) text += (text ? " " : "") + alt;
      }
      if (text) onChange(value ? `${value} ${text}` : text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }

  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="mb-1 flex items-center justify-between">
        <label className="text-xs text-muted">Хотите что-то добавить? (необязательно)</label>
        {supported && (
          <button
            type="button"
            onClick={toggle}
            className={`rounded-md border px-2.5 py-1 text-xs ${
              listening ? "border-accent bg-accent/10 text-accent" : "border-line text-muted hover:text-ink"
            }`}
          >
            {listening ? "● Слушаю… стоп" : "🎤 Надиктовать"}
          </button>
        )}
      </div>
      <textarea
        className="input min-h-16"
        placeholder="Всё, что не вошло в вопрос: детали, пожелания, контекст"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
