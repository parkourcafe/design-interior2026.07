"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DESIGNER_QUESTION_PRESETS,
  STANDARD_BRIEF_QUESTION_PREVIEW,
  normalizeCustomQuestions,
  optionValueFromLabel,
  type CustomBriefQuestion,
  type CustomQuestionType,
} from "@/lib/brief/custom-questions";
import { ru } from "@/lib/i18n/ru";
import { saveCustomQuestions } from "./actions";

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface StructureResponse {
  ok?: boolean;
  llmOk?: boolean;
  question?: CustomBriefQuestion;
}

const TYPES: { value: CustomQuestionType; label: string }[] = [
  { value: "text", label: ru.briefBuilder.types.text },
  { value: "choice", label: ru.briefBuilder.types.choice },
  { value: "multi", label: ru.briefBuilder.types.multi },
  { value: "number", label: ru.briefBuilder.types.number },
];

function recognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const candidate = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null;
}

function optionsText(question: CustomBriefQuestion): string {
  return question.options?.map((option) => option.label).join(", ") ?? "";
}

function parseOptions(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((label, index) => ({ value: optionValueFromLabel(label, index), label }));
}

function cleanForSave(items: CustomBriefQuestion[]): CustomBriefQuestion[] {
  return normalizeCustomQuestions(items);
}

// Редактор своих вопросов дизайнера. Они добавляются в конец брифа клиента.
export default function CustomQuestions({
  projectId,
  initial,
}: {
  projectId: string;
  initial: CustomBriefQuestion[];
}) {
  const [items, setItems] = useState<CustomBriefQuestion[]>(initial);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState("");
  const [structuring, setStructuring] = useState(false);
  const [voiceState, setVoiceState] = useState<"idle" | "listening" | "unsupported">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const router = useRouter();

  const standardCounts = useMemo(() => {
    const quick = STANDARD_BRIEF_QUESTION_PREVIEW.filter((question) => question.tier === "quick").length;
    return { quick, total: STANDARD_BRIEF_QUESTION_PREVIEW.length };
  }, []);

  function markDirty() {
    setSaved(false);
    setMessage(null);
  }

  function update(i: number, patch: Partial<CustomBriefQuestion>) {
    setItems((prev) => prev.map((item, idx) => (idx === i ? { ...item, ...patch } : item)));
    markDirty();
  }

  function addBlank() {
    setItems((prev) => [
      ...prev,
      {
        title: "",
        type: "text",
        placeholder: ru.briefBuilder.manualPlaceholder,
        source: "manual",
      },
    ]);
    markDirty();
  }

  function addPreset(presetId: string) {
    const preset = DESIGNER_QUESTION_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    setItems((prev) => cleanForSave([...prev, ...preset.questions]).slice(0, 15));
    markDirty();
  }

  function remove(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
    markDirty();
  }

  async function structureDraft() {
    const phrase = draft.trim();
    if (phrase.length < 5) return;
    setStructuring(true);
    setMessage(null);
    const response = await fetch("/api/brief/custom-question/structure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phrase }),
    }).catch(() => null);
    const json = (await response?.json().catch(() => null)) as StructureResponse | null;
    if (response?.ok && json?.question) {
      setItems((prev) => cleanForSave([...prev, json.question!]).slice(0, 15));
      setDraft("");
      setMessage(json.llmOk ? ru.briefBuilder.structured : ru.briefBuilder.fallbackStructured);
      setSaved(false);
    } else {
      setMessage(ru.briefBuilder.structureError);
    }
    setStructuring(false);
  }

  function startVoice() {
    const Constructor = recognitionConstructor();
    if (!Constructor) {
      setVoiceState("unsupported");
      return;
    }
    const recognition = new Constructor();
    recognition.lang = "ru-RU";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .flatMap((result) => Array.from(result).map((item) => item.transcript))
        .join(" ")
        .trim();
      if (transcript) setDraft((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    recognition.onerror = () => setVoiceState("idle");
    recognition.onend = () => setVoiceState("idle");
    recognitionRef.current = recognition;
    setVoiceState("listening");
    recognition.start();
  }

  function stopVoice() {
    recognitionRef.current?.stop();
    setVoiceState("idle");
  }

  function save() {
    startTransition(async () => {
      const clean = cleanForSave(items);
      const res = await saveCustomQuestions(projectId, clean);
      if (res.ok) {
        setItems(clean);
        setSaved(true);
        router.refresh();
      }
    });
  }

  return (
    <section className="card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-medium">{ru.briefBuilder.title}</h3>
          <p className="mt-1 text-sm text-muted">
            {ru.briefBuilder.standardIncluded(standardCounts.quick, standardCounts.total)}
          </p>
        </div>
        <button onClick={addBlank} className="btn-ghost self-start">
          {ru.briefBuilder.addManual}
        </button>
      </div>

      <div className="mt-4 rounded-md border border-line bg-line/20 p-3">
        <p className="text-sm font-medium">{ru.briefBuilder.presetsTitle}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {DESIGNER_QUESTION_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => addPreset(preset.id)}
              className="rounded-md border border-line bg-white p-3 text-left text-sm hover:border-accent"
            >
              <span className="block font-medium">{preset.label}</span>
              <span className="mt-1 block text-xs leading-relaxed text-muted">{preset.description}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-md border border-line bg-white p-3">
        <label className="label">{ru.briefBuilder.voiceTitle}</label>
        <textarea
          className="input min-h-20"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={ru.briefBuilder.voicePlaceholder}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {voiceState === "listening" ? (
            <button type="button" onClick={stopVoice} className="btn-ghost">
              {ru.briefBuilder.stopVoice}
            </button>
          ) : (
            <button type="button" onClick={startVoice} className="btn-ghost">
              {ru.briefBuilder.startVoice}
            </button>
          )}
          <button
            type="button"
            onClick={structureDraft}
            disabled={structuring || draft.trim().length < 5}
            className="btn-primary"
          >
            {structuring ? ru.briefBuilder.structuring : ru.briefBuilder.structure}
          </button>
          {voiceState === "unsupported" && (
            <span className="text-xs text-muted">{ru.briefBuilder.voiceUnsupported}</span>
          )}
        </div>
        {message && <p className="mt-2 text-sm text-muted">{message}</p>}
      </div>

      <div className="mt-4 space-y-3">
        {items.length === 0 && (
          <p className="rounded-md border border-dashed border-line p-4 text-sm text-muted">
            {ru.briefBuilder.empty}
          </p>
        )}
        {items.map((question, i) => (
          <div key={`${question.title}-${i}`} className="rounded-md border border-line bg-white p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_160px_auto]">
              <input
                className="input"
                placeholder={ru.briefBuilder.questionPlaceholder}
                value={question.title}
                onChange={(event) => update(i, { title: event.target.value })}
              />
              <select
                className="input"
                value={question.type}
                onChange={(event) => {
                  const type = event.target.value as CustomQuestionType;
                  update(i, {
                    type,
                    options:
                      type === "choice" || type === "multi"
                        ? question.options ?? [
                            { value: "yes", label: ru.common.yes },
                            { value: "no", label: ru.common.no },
                          ]
                        : undefined,
                  });
                }}
              >
                {TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
              <button onClick={() => remove(i)} className="btn-ghost px-3" aria-label={ru.briefBuilder.remove}>
                ×
              </button>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input
                className="input"
                placeholder={ru.briefBuilder.helpPlaceholder}
                value={question.help ?? ""}
                onChange={(event) => update(i, { help: event.target.value || undefined })}
              />
              <input
                className="input"
                placeholder={ru.briefBuilder.answerPlaceholder}
                value={question.placeholder ?? ""}
                onChange={(event) => update(i, { placeholder: event.target.value || undefined })}
              />
            </div>
            {(question.type === "choice" || question.type === "multi") && (
              <input
                className="input mt-2"
                placeholder={ru.briefBuilder.optionsPlaceholder}
                value={optionsText(question)}
                onChange={(event) => update(i, { options: parseOptions(event.target.value) })}
              />
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button onClick={addBlank} className="btn-ghost">
          {ru.briefBuilder.addManual}
        </button>
        <button onClick={save} disabled={pending} className="btn-primary">
          {pending ? ru.briefBuilder.saving : saved ? ru.briefBuilder.saved : ru.briefBuilder.save}
        </button>
      </div>
    </section>
  );
}
