"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveCustomQuestions } from "./actions";

// Редактор своих вопросов дизайнера. Они добавляются в конец брифа клиента.
export default function CustomQuestions({
  projectId,
  initial,
}: {
  projectId: string;
  initial: string[];
}) {
  const [items, setItems] = useState<string[]>(initial.length ? initial : [""]);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function update(i: number, v: string) {
    setItems((prev) => prev.map((x, idx) => (idx === i ? v : x)));
    setSaved(false);
  }
  function add() {
    setItems((prev) => [...prev, ""]);
  }
  function remove(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
    setSaved(false);
  }
  function save() {
    startTransition(async () => {
      const res = await saveCustomQuestions(projectId, items);
      if (res.ok) {
        setSaved(true);
        router.refresh();
      }
    });
  }

  return (
    <div className="card">
      <h3 className="font-medium">Ваши вопросы клиенту</h3>
      <p className="mt-1 text-sm text-muted">
        Добавьте свои вопросы — клиент увидит их в конце брифа, после стандартных.
      </p>
      <div className="mt-3 space-y-2">
        {items.map((q, i) => (
          <div key={i} className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="Например: есть ли встроенная техника, которую нужно сохранить?"
              value={q}
              onChange={(e) => update(i, e.target.value)}
            />
            <button onClick={() => remove(i)} className="btn-ghost px-3" aria-label="Удалить">
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button onClick={add} className="btn-ghost">
          + Ещё вопрос
        </button>
        <button onClick={save} disabled={pending} className="btn-primary">
          {pending ? "Сохраняем…" : saved ? "Сохранено" : "Сохранить"}
        </button>
      </div>
    </div>
  );
}
