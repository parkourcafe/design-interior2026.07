"use client";

import { type ChangeEvent, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CUSTOM_QUESTIONS_LIMIT,
  DESIGNER_QUESTION_PRESETS,
  STANDARD_BRIEF_QUESTION_PREVIEW,
  normalizeCustomQuestions,
  optionValueFromLabel,
  type BriefPackPlanFile,
  type BriefPackProjectType,
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

interface GeneratePackResponse {
  ok?: boolean;
  llmOk?: boolean;
  questions?: CustomBriefQuestion[];
}

interface PlanUploadResponse {
  ok?: boolean;
  file?: BriefPackPlanFile;
}

const TYPES: { value: CustomQuestionType; label: string }[] = [
  { value: "text", label: ru.briefBuilder.types.text },
  { value: "choice", label: ru.briefBuilder.types.choice },
  { value: "multi", label: ru.briefBuilder.types.multi },
  { value: "number", label: ru.briefBuilder.types.number },
];

const PROJECT_TYPES: { value: BriefPackProjectType; label: string }[] = [
  { value: "commercial", label: ru.briefBuilder.projectTypes.commercial },
  { value: "wellness", label: ru.briefBuilder.projectTypes.wellness },
  { value: "restaurant", label: ru.briefBuilder.projectTypes.restaurant },
  { value: "office", label: ru.briefBuilder.projectTypes.office },
  { value: "retail", label: ru.briefBuilder.projectTypes.retail },
  { value: "hospitality", label: ru.briefBuilder.projectTypes.hospitality },
  { value: "residential", label: ru.briefBuilder.projectTypes.residential },
  { value: "other", label: ru.briefBuilder.projectTypes.other },
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
  const [packProjectType, setPackProjectType] = useState<BriefPackProjectType>("commercial");
  const [packDescription, setPackDescription] = useState("");
  const [packArea, setPackArea] = useState("");
  const [packLocation, setPackLocation] = useState("");
  const [packPlanNotes, setPackPlanNotes] = useState("");
  const [packFiles, setPackFiles] = useState<BriefPackPlanFile[]>([]);
  const [packGenerating, setPackGenerating] = useState(false);
  const [packUploading, setPackUploading] = useState(false);
  const [packMessage, setPackMessage] = useState<string | null>(null);
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
    setItems((prev) => cleanForSave([...prev, ...preset.questions]));
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
      setItems((prev) => cleanForSave([...prev, json.question!]));
      setDraft("");
      setMessage(json.llmOk ? ru.briefBuilder.structured : ru.briefBuilder.fallbackStructured);
      setSaved(false);
    } else {
      setMessage(ru.briefBuilder.structureError);
    }
    setStructuring(false);
  }

  async function uploadPlan(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setPackUploading(true);
    setPackMessage(null);
    const form = new FormData();
    form.set("projectId", projectId);
    form.set("file", file);
    const response = await fetch("/api/brief/custom-question/plan-upload", {
      method: "POST",
      body: form,
    }).catch(() => null);
    const json = (await response?.json().catch(() => null)) as PlanUploadResponse | null;
    if (response?.ok && json?.file) {
      const uploaded = json.file;
      setPackFiles((prev) => [...prev, uploaded].slice(-5));
      setPackMessage(ru.briefBuilder.planUploaded(uploaded.name));
    } else {
      setPackMessage(ru.briefBuilder.planUploadError);
    }
    setPackUploading(false);
  }

  async function generateBriefPack() {
    const description = packDescription.trim();
    if (description.length < 5) {
      setPackMessage(ru.briefBuilder.packDescriptionRequired);
      return;
    }
    const rawArea = packArea.trim();
    const normalizedArea = rawArea ? Number(rawArea.replace(",", ".")) : null;
    if (normalizedArea !== null && (!Number.isFinite(normalizedArea) || normalizedArea <= 0)) {
      setPackMessage(ru.briefBuilder.packAreaError);
      return;
    }
    setPackGenerating(true);
    setPackMessage(null);
    const response = await fetch("/api/brief/custom-question/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        projectType: packProjectType,
        description,
        areaM2: normalizedArea,
        location: packLocation,
        planNotes: packPlanNotes,
        planFiles: packFiles,
      }),
    }).catch(() => null);
    const json = (await response?.json().catch(() => null)) as GeneratePackResponse | null;
    if (response?.ok && json?.questions?.length) {
      const next = cleanForSave([...items, ...json.questions]).slice(0, CUSTOM_QUESTIONS_LIMIT);
      setItems(next);
      setSaved(false);
      setPackMessage(
        json.llmOk
          ? ru.briefBuilder.packGenerated(json.questions.length)
          : ru.briefBuilder.packFallback(json.questions.length),
      );
    } else {
      setPackMessage(ru.briefBuilder.packError);
    }
    setPackGenerating(false);
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
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">{ru.briefBuilder.packTitle}</p>
          <p className="text-xs leading-relaxed text-muted">{ru.briefBuilder.packHint}</p>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_120px_1fr]">
          <label>
            <span className="label">{ru.briefBuilder.projectTypeLabel}</span>
            <select
              className="input"
              value={packProjectType}
              onChange={(event) => setPackProjectType(event.target.value as BriefPackProjectType)}
            >
              {PROJECT_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">{ru.briefBuilder.packAreaLabel}</span>
            <input
              className="input"
              inputMode="decimal"
              value={packArea}
              onChange={(event) => setPackArea(event.target.value)}
              placeholder="300"
            />
          </label>
          <label>
            <span className="label">{ru.briefBuilder.packLocationLabel}</span>
            <input
              className="input"
              value={packLocation}
              onChange={(event) => setPackLocation(event.target.value)}
              placeholder="Бали"
            />
          </label>
        </div>
        <label className="mt-3 block">
          <span className="label">{ru.briefBuilder.packDescriptionLabel}</span>
          <textarea
            className="input min-h-24"
            value={packDescription}
            onChange={(event) => setPackDescription(event.target.value)}
            placeholder={ru.briefBuilder.packDescriptionPlaceholder}
          />
        </label>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label>
            <span className="label">{ru.briefBuilder.packPlanLabel}</span>
            <input
              className="input"
              type="file"
              accept="image/*,.pdf,.dwg,.dxf"
              onChange={uploadPlan}
              disabled={packUploading}
            />
            <span className="mt-1 block text-xs text-muted">{ru.briefBuilder.packPlanHelp}</span>
          </label>
          <label>
            <span className="label">{ru.briefBuilder.packPlanNotesLabel}</span>
            <textarea
              className="input min-h-20"
              value={packPlanNotes}
              onChange={(event) => setPackPlanNotes(event.target.value)}
              placeholder={ru.briefBuilder.packPlanNotesPlaceholder}
            />
          </label>
        </div>
        {packFiles.length > 0 && (
          <p className="mt-2 text-xs text-muted">
            {ru.briefBuilder.attachedPlans}: {packFiles.map((file) => file.name).join(", ")}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={generateBriefPack}
            disabled={packGenerating || packUploading || packDescription.trim().length < 5}
            className="btn-primary"
          >
            {packGenerating ? ru.briefBuilder.packGenerating : ru.briefBuilder.packGenerate}
          </button>
          {packUploading && <span className="text-xs text-muted">{ru.briefBuilder.uploadingPlan}</span>}
        </div>
        {packMessage && <p className="mt-2 text-sm text-muted">{packMessage}</p>}
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
