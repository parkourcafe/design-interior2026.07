"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type {
  ProjectLinkAccess,
  ProjectLinkProjection,
} from "@/lib/integration-gateway/links/project-link-service";
import type { StudioProjectLinkCatalogItem } from "@/lib/integration-gateway/links/catalog";
import { ru } from "@/lib/i18n/ru";

type FormState = {
  readonly title: string;
  readonly url: string;
  readonly tags: string;
  readonly note: string;
};

const emptyForm: FormState = { title: "", url: "", tags: "", note: "" };

function catalogLabel(item: StudioProjectLinkCatalogItem): string {
  const key = item.labelKey.split(".").pop() as keyof typeof ru.projectLinks.catalog;
  return ru.projectLinks.catalog[key] ?? item.url;
}

function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 12);
}

async function postJson(path: string, body: unknown): Promise<boolean> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  return response.ok;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function ProjectLinksPanel({
  projectId,
  links,
  access,
  catalog,
}: {
  readonly projectId: string;
  readonly links: readonly ProjectLinkProjection[];
  readonly access: ProjectLinkAccess;
  readonly catalog: readonly StudioProjectLinkCatalogItem[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  function selectCatalog(item: StudioProjectLinkCatalogItem): void {
    setForm((current) => ({
      ...current,
      title: catalogLabel(item),
      url: item.url,
    }));
  }

  async function createLink(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(false);
    const ok = await postJson(`/api/projects/${projectId}/links`, {
      category: "reference",
      title: form.title,
      url: form.url,
      tags: parseTags(form.tags),
      note: form.note || null,
    }).catch(() => false);
    setPending(false);
    if (!ok) {
      setError(true);
      return;
    }
    setForm(emptyForm);
    router.refresh();
  }

  if (access.clientProjection) {
    return (
      <section className="space-y-5">
        <div>
          <h1 className="font-display text-3xl font-semibold">{ru.projectLinks.title}</h1>
          <p className="mt-1 text-sm text-muted">{ru.projectLinks.clientHint}</p>
        </div>
        {links.length === 0 ? (
          <p className="text-sm text-muted">{ru.projectLinks.emptyPublished}</p>
        ) : (
          <div className="divide-y divide-line border-y border-line bg-white">
            {links.map((link) => <ProjectLinkRow key={link.linkId} link={link} />)}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">{ru.projectLinks.title}</h1>
          <p className="mt-1 text-sm text-muted">{ru.projectLinks.teamHint}</p>
        </div>
        <span className="rounded-full bg-line/50 px-3 py-1 text-xs text-muted">
          {ru.projectLinks.count(links.length)}
        </span>
      </div>

      {access.canContribute && (
        <form onSubmit={createLink} className="border-y border-line bg-white py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="label">
              {ru.projectLinks.fields.title}
              <input
                className="input mt-1"
                value={form.title}
                maxLength={200}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                required
              />
            </label>
            <label className="label">
              {ru.projectLinks.fields.url}
              <input
                className="input mt-1"
                type="url"
                value={form.url}
                maxLength={4096}
                onChange={(event) => setForm({ ...form, url: event.target.value })}
                required
              />
            </label>
            <label className="label">
              {ru.projectLinks.fields.tags}
              <input
                className="input mt-1"
                value={form.tags}
                onChange={(event) => setForm({ ...form, tags: event.target.value })}
                placeholder={ru.projectLinks.fields.tagsPlaceholder}
              />
            </label>
            <label className="label">
              {ru.projectLinks.fields.note}
              <input
                className="input mt-1"
                value={form.note}
                maxLength={2000}
                onChange={(event) => setForm({ ...form, note: event.target.value })}
              />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {catalog.map((item) => (
              <button
                key={item.id}
                type="button"
                className="btn-ghost text-sm"
                onClick={() => selectCatalog(item)}
              >
                {catalogLabel(item)}
              </button>
            ))}
            <button type="submit" className="btn-primary" disabled={pending}>
              {pending ? ru.projectLinks.actions.saving : ru.projectLinks.actions.add}
            </button>
          </div>
          {error && <p role="status" className="mt-3 text-sm text-red-700">{ru.projectLinks.errors.save}</p>}
        </form>
      )}

      {links.length === 0 ? (
        <p className="text-sm text-muted">{ru.projectLinks.empty}</p>
      ) : (
        <div className="divide-y divide-line border-y border-line bg-white">
          {links.map((link) => (
            <ProjectLinkRow
              key={link.linkId}
              link={link}
              projectId={projectId}
              canPublish={access.canPublish}
              canContribute={access.canContribute}
              onChanged={() => router.refresh()}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ProjectLinkRow({
  link,
  projectId,
  canPublish = false,
  canContribute = false,
  onChanged,
}: {
  readonly link: ProjectLinkProjection;
  readonly projectId?: string;
  readonly canPublish?: boolean;
  readonly canContribute?: boolean;
  readonly onChanged?: () => void;
}) {
  const [revisionUrl, setRevisionUrl] = useState(link.normalizedUrl);
  const [revisionNote, setRevisionNote] = useState(link.note ?? "");
  const [revisionReason, setRevisionReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function publish(): Promise<void> {
    if (!projectId || pending) return;
    setPending(true);
    setError(false);
    const ok = await postJson(
      `/api/projects/${projectId}/links/${link.linkId}/publish`,
      { revisionNo: link.currentRevisionNo },
    ).catch(() => false);
    setPending(false);
    if (!ok) setError(true);
    else onChanged?.();
  }

  async function revise(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!projectId || pending) return;
    setPending(true);
    setError(false);
    const ok = await postJson(
      `/api/projects/${projectId}/links/${link.linkId}/revisions`,
      { url: revisionUrl, tags: link.tags, note: revisionNote || null, reason: revisionReason || null },
    ).catch(() => false);
    setPending(false);
    if (!ok) setError(true);
    else onChanged?.();
  }

  return (
    <article className="space-y-3 px-4 py-5 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium">{link.title}</h2>
            <span className="rounded-full bg-line/50 px-2 py-0.5 text-[11px] text-muted">
              {link.visibility === "published_to_client" ? ru.projectLinks.published : ru.projectLinks.internal}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">
            {link.domain} · {ru.projectLinks.revision(link.revisionNo)} · {formatDate(link.capturedAt)}
          </p>
        </div>
        <a
          href={link.normalizedUrl}
          target="_blank"
          rel="noreferrer"
          className="btn-ghost shrink-0 text-sm"
        >
          {ru.projectLinks.actions.open}
        </a>
      </div>
      {link.tags.length > 0 && <p className="text-xs text-muted">{link.tags.join(" · ")}</p>}
      {link.note && <p className="text-sm text-ink/80">{link.note}</p>}
      {projectId && (canContribute || canPublish) && (
        <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
          {canContribute && (
            <form onSubmit={revise} className="flex min-w-0 flex-1 flex-wrap gap-2">
              <input
                className="input min-w-56 flex-1 text-sm"
                value={revisionUrl}
                onChange={(event) => setRevisionUrl(event.target.value)}
                aria-label={ru.projectLinks.fields.newUrl}
                required
              />
              <input
                className="input min-w-44 flex-1 text-sm"
                value={revisionNote}
                onChange={(event) => setRevisionNote(event.target.value)}
                aria-label={ru.projectLinks.fields.note}
              />
              <input
                className="input min-w-44 flex-1 text-sm"
                value={revisionReason}
                onChange={(event) => setRevisionReason(event.target.value)}
                aria-label={ru.projectLinks.fields.reason}
              />
              <button type="submit" className="btn-ghost text-sm" disabled={pending}>
                {ru.projectLinks.actions.revise}
              </button>
            </form>
          )}
          {canPublish && link.publishedRevisionNo !== link.currentRevisionNo && (
            <button type="button" className="btn-primary text-sm" onClick={publish} disabled={pending}>
              {ru.projectLinks.actions.publish}
            </button>
          )}
        </div>
      )}
      {error && <p role="status" className="text-xs text-red-700">{ru.projectLinks.errors.save}</p>}
    </article>
  );
}
