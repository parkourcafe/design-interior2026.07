import Link from "next/link";
import { notFound } from "next/navigation";
import CopyTextButton from "@/components/copy-text-button";
import { conceptPackSchema } from "@/lib/concept/schema";
import { ru } from "@/lib/i18n/ru";
import { createClient } from "@/lib/supabase/server";
import type { Passport } from "@/lib/types";
import CreateConceptPackButton from "./create-button";

export const dynamic = "force-dynamic";

interface ProjectRow {
  id: string;
  client_name: string;
  passport: Passport | null;
}

interface ConceptPackRow {
  status: string;
  content: unknown;
  created_at: string;
}

function createdAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return ru.conceptPack.created;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export default async function ConceptPackPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const [projectResult, packResult] = await Promise.all([
    supabase
      .from("projects")
      .select("id, client_name, passport")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("concept_packs")
      .select("status, content, created_at")
      .eq("project_id", id)
      .maybeSingle(),
  ]);

  if (!projectResult.data) notFound();
  const project = projectResult.data as ProjectRow;
  if (!project.passport) notFound();

  const packRow = packResult.data as ConceptPackRow | null;
  if (!packRow) {
    return (
      <div className="space-y-6">
        <Header project={project} />
        <section className="card">
          <h2 className="font-display text-2xl font-semibold">{ru.conceptPack.emptyTitle}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            {ru.conceptPack.emptyHint}
          </p>
          <div className="mt-5">
            <CreateConceptPackButton projectId={project.id} />
          </div>
        </section>
      </div>
    );
  }

  if (packRow.status !== "ready") notFound();
  const parsed = conceptPackSchema.safeParse(packRow.content);
  if (!parsed.success) notFound();
  const pack = parsed.data;

  return (
    <div className="space-y-8">
      <Header project={project} date={createdAt(packRow.created_at)} />

      <p className="rounded-md border border-line bg-white p-3 text-sm text-muted">
        {ru.conceptPack.privateNote}
      </p>

      <section className="card border-l-4 border-l-accent">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-accent">
          {ru.conceptPack.sections.summary}
        </p>
        <p className="mt-3 text-lg leading-relaxed text-ink">{pack.project_summary}</p>
      </section>

      <div className="grid gap-6 sm:grid-cols-2">
        <section className="card">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
            {ru.conceptPack.sections.style}
          </p>
          <h2 className="mt-2 font-display text-2xl font-semibold">
            {pack.style_direction.title}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {pack.style_direction.rationale}
          </p>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm">
            {pack.style_direction.principles.map((principle) => (
              <li key={principle}>{principle}</li>
            ))}
          </ul>
          <div className="mt-5 border-t border-line pt-4">
            <h3 className="text-sm font-medium">{ru.conceptPack.avoid}</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
              {pack.style_direction.avoid.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="card">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
            {ru.conceptPack.sections.palette}
          </p>
          <PaletteLine label={ru.conceptPack.base} values={pack.palette_direction.base} />
          <PaletteLine label={ru.conceptPack.accents} values={pack.palette_direction.accents} />
          <PaletteLine label={ru.conceptPack.materials} values={pack.palette_direction.materials} />
          <p className="mt-5 border-t border-line pt-4 text-sm leading-relaxed text-muted">
            {pack.palette_direction.note}
          </p>
        </section>
      </div>

      <section>
        <div className="mb-4">
          <h2 className="font-display text-2xl font-semibold">
            {ru.conceptPack.sections.moodboard}
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">
            {pack.moodboard_outline.direction}
          </p>
        </div>
        <ol className="grid gap-4 sm:grid-cols-2">
          {pack.moodboard_outline.frames.map((frame, index) => (
            <li key={frame.id} className="card">
              <div className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent">
                  {index + 1}
                </span>
                <div>
                  <h3 className="font-medium">{frame.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{frame.brief}</p>
                </div>
              </div>
              <div className="mt-4 border-t border-line pt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">
                  {ru.conceptPack.searchPrompts}
                </p>
                <ul className="mt-2 space-y-1 text-sm">
                  {frame.search_prompts.map((prompt) => (
                    <li key={prompt}>“{prompt}”</li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 className="mb-4 font-display text-2xl font-semibold">
          {ru.conceptPack.sections.rooms}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {pack.room_directions.map((room) => (
            <article key={room.id} className="card">
              <h3 className="font-medium">{room.zone}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{room.concept}</p>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                {room.priorities.map((priority) => (
                  <li key={priority}>{priority}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-line bg-line/20 p-6">
        <h2 className="font-display text-2xl font-semibold">
          {ru.conceptPack.sections.designerNotes}
        </h2>
        <p className="mt-1 text-sm text-muted">{ru.conceptPack.designerOnly}</p>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm">
          {pack.designer_notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </section>

      <section className="card border border-accent/30">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-display text-2xl font-semibold">
              {ru.conceptPack.sections.clientSummary}
            </h2>
            <p className="mt-1 text-sm text-muted">{ru.conceptPack.clientSummaryHint}</p>
          </div>
          <CopyTextButton text={pack.client_ready_summary} label={ru.conceptPack.copySummary} />
        </div>
        <p className="mt-5 whitespace-pre-line text-base leading-relaxed">
          {pack.client_ready_summary}
        </p>
      </section>
    </div>
  );
}

function Header({ project, date }: { project: ProjectRow; date?: string }) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <Link
          href={`/dashboard/projects/${project.id}`}
          className="text-sm text-muted hover:text-ink"
        >
          ← {ru.review.title}
        </Link>
        <h1 className="mt-1 font-display text-3xl font-semibold">{ru.conceptPack.title}</h1>
        <p className="mt-1 text-sm text-muted">{project.client_name}</p>
      </div>
      {date && (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-accent/10 px-3 py-1 font-medium text-accent">
            {ru.conceptPack.ready}
          </span>
          <span className="rounded-full bg-line/50 px-3 py-1 text-muted">
            {ru.conceptPack.created}: {date}
          </span>
        </div>
      )}
    </header>
  );
}

function PaletteLine({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="mt-4 first:mt-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {values.map((value) => (
          <span key={value} className="rounded-full border border-line bg-paper px-3 py-1 text-sm">
            {value}
          </span>
        ))}
      </div>
    </div>
  );
}
